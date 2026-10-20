require('./setup.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const admin=require('../src/lib/supabase/admin.ts'),auth=require('../src/lib/analytics/auth.ts'),provider=require('../src/lib/analytics/olist-client.ts');
const {normalizeCostHistoryPage,processCostHistorySync,queueCostHistory}=require('../src/lib/analytics/cost-history-sync.ts');
const {parseABCFilters}=require('../src/lib/analytics/filters.ts');
const {filters}=require('../scripts/analytics-isolated.cjs');
const catalog=require('../src/lib/analytics/data/composition-catalog.json');

test('history parser keeps provider effective dates separate from fetch time and preserves both cost methods',()=>{
 const page=normalizeCostHistoryPage({itens:[
  {data:'15/09/2026',precoCusto:'12.345678',custoMedio:'9.876543'},
  {data:'2026-09-15 16:20:30',precoCusto:4,custoMedio:0},
  {data:'2026-09-15T23:59:00-03:00',precoCusto:5},
  {data:'2026-09-16',precoCusto:'-12.345678',custoMedio:'-0.000001'},
 ]},0);
 assert.equal(page.events[0].effective_at,'2026-09-15');assert.equal(page.events[0].purchase_cents,'1234.5678');assert.equal(page.events[0].average_cents,'987.6543');
 assert.equal(page.events[1].effective_at,'2026-09-15 16:20:30');assert.equal(page.events[1].average_cents,'0.0000');assert.equal(page.events[2].average_cents,null);
 assert.equal(page.events[3].purchase_cents,'-1234.5678');assert.equal(page.events[3].average_cents,'-0.0001');
 assert.equal(page.done,true);
 const raw={data:'2026-09-01',precoCusto:1,custoMedio:2};
 const duplicate=normalizeCostHistoryPage({itens:[raw,raw],paginacao:{total:3}},0);
 assert.equal(duplicate.events.length,1);assert.equal(duplicate.count,2);assert.equal(duplicate.done,false);
 for(const body of [{},{itens:[{data:'2026-02-30'}]},{itens:[{data:'yesterday'}]},{itens:[{data:'2026-09-15 25:00:00'}]},{itens:[],paginacao:{total:1}}])assert.throws(()=>normalizeCostHistoryPage(body,0));
 assert.equal(parseABCFilters(filters).costBasis,'purchase');assert.equal(parseABCFilters({...filters,costBasis:'average'}).costBasis,'average');
 assert.throws(()=>parseABCFilters({...filters,costBasis:'current'}),/CMV/);
});

test('bounded historical worker uses one account lease, fetches the full history and publishes only acknowledged pages',async t=>{
 const batch={workspace_id:'trusted',connection_id:'olist1',connection_version:3,lease:'lease',jobs:[{external_id:'10',scan_id:'scan',page_offset:0,attempts:0}]},calls=[];
 t.mock.method(admin,'createAdminClient',()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:name==='analytics_claim_cost_history'?batch:null,error:null};}}));
 t.mock.method(auth,'analyticsToken',async(w,c)=>{assert.equal(w,'trusted');assert.equal(c,'olist1');return 'secret';});
 t.mock.method(auth,'ensureAnalyticsIdentity',async()=>{});
 t.mock.method(provider,'olistRequest',async(token,c,path)=>{assert.equal(token,'secret');assert.equal(c,'olist1');assert.equal(path,'/produtos/10/custos?limit=100&offset=0');return{itens:[{data:'2026-08-01',precoCusto:10,custoMedio:8}]};});
 const result=await processCostHistorySync();assert.equal(result.claimed,true);assert.equal(result.processed,1);
 const save=calls.find(c=>c.name==='analytics_finish_cost_history_page').args;
 assert.equal(save.p_lease,'lease');assert.equal(save.p_version,3);assert.equal(save.p_events[0].effective_at,'2026-08-01');assert.equal(save.p_done,true);
 assert.equal(calls.at(-1).name,'analytics_release_cost_history');assert.equal(JSON.stringify(calls).includes('secret'),false);
});

test('historical 429 retains provider checkpoint and pauses the shared account; an idle queue makes no HTTP requests',async t=>{
 const batch={workspace_id:'w',connection_id:'c',connection_version:1,lease:'lease',jobs:[{external_id:'1',scan_id:'scan',page_offset:100,attempts:0}]},calls=[];
 t.mock.method(admin,'createAdminClient',()=>({rpc:async(name,args)=>{calls.push({name,args});return{data:name==='analytics_claim_cost_history'?batch:null,error:null};}}));
 t.mock.method(auth,'analyticsToken',async()=> 'token');t.mock.method(auth,'ensureAnalyticsIdentity',async()=>{});
 t.mock.method(provider,'olistRequest',async()=>{throw new provider.AnalyticsApiError(429,123);});
 assert.ok((await processCostHistorySync()).error);
 const save=calls.find(c=>c.name==='analytics_finish_cost_history_page').args;assert.equal(save.p_offset,100);assert.equal(save.p_retry,123);assert.equal(save.p_events,undefined);
 assert.equal(calls.at(-1).args.p_cooldown,123);
 t.mock.method(admin,'createAdminClient',()=>({rpc:async()=>({data:null})}));
 t.mock.method(auth,'analyticsToken',async()=>{throw Error('Must not run');});
 assert.deepEqual(await processCostHistorySync(),{claimed:false,processed:0});
});

test('history enrichment is restricted to reviewed workspaces and canonical component SKUs',async t=>{
 const calls=[];t.mock.method(admin,'createAdminClient',()=>({rpc:async(name,args)=>{calls.push({name,args});return{error:null};}}));
 await queueCostHistory('foreign');assert.equal(calls.length,0);
 await queueCostHistory(catalog.workspaceIds[0],true);assert.equal(calls.length,1);
 assert.equal(calls[0].name,'analytics_queue_cost_history');assert.equal(calls[0].args.p_force,true);
 assert.ok(calls[0].args.p_skus.includes('ACFS000-K001'));assert.equal(calls[0].args.p_skus.includes('ACTM011-K011'),false);
});
