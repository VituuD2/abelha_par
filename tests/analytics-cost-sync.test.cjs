require('./setup.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const admin=require('../src/lib/supabase/admin.ts');
const auth=require('../src/lib/analytics/auth.ts');
const provider=require('../src/lib/analytics/olist-client.ts');
const {normalizeCostPage,processCostSync}=require('../src/lib/analytics/cost-sync.ts');

test('cost listing preserves sub-cent precision and never uses selling price or average cost as a fallback',()=>{
  const page=normalizeCostPage({itens:[
    {id:1,sku:' acfs000-k001 ',precos:{precoCusto:'12.345678',preco:99}},
    {id:2,sku:'B',precos:{precoCusto:0,precoCustoMedio:15}},
    {id:3,sku:'C',precos:{preco:30,precoCustoMedio:20}},
    {id:4,sku:'D',precos:{precoCusto:-2}},
    {id:5,precos:{precoCusto:10}},
    {id:6,sku:'E',situacao:'E',precos:{precoCusto:10}},
    {id:7,sku:'I',situacao:'I',precos:{precoCusto:10}},
  ],paginacao:{total:7}},0);
  assert.equal(page.products[0].cost_cents,'1234.5678');
  assert.equal(page.products[0].sku,'ACFS000-K001');
  assert.equal(page.products[1].cost_cents,'0.0000');
  assert.equal(page.products[2].cost_cents,null);assert.equal(page.products[3].cost_cents,null);
  assert.equal(page.products[4].sku,null);assert.equal(page.products[4].active,false);
  assert.equal(page.products[5].active,false);assert.equal(page.products[6].active,true);
  assert.equal(page.done,true);
  for(const body of [{},{itens:[] ,paginacao:{total:10}},{itens:[{id:0}]},{itens:[{id:1},{id:1}]}])
    assert.throws(()=>normalizeCostPage(body,0));
  assert.equal(normalizeCostPage({itens:Array.from({length:100},(_,i)=>({id:i+1,sku:`S${i}`})),paginacao:{total:101}},0).done,false);
});

test('worker uses its trusted leased account, makes one product request and commits its page atomically',async t=>{
  const calls=[],job={workspace_id:'trusted',connection_id:'olist1',lease:'lease',connection_version:4,page_offset:100,attempts:0};
  t.mock.method(admin,'createAdminClient',()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='analytics_claim_cost_sync'?job:null,error:null};}}));
  t.mock.method(auth,'analyticsToken',async(w,c)=>{assert.equal(w,'trusted');assert.equal(c,'olist1');return 'secret';});
  t.mock.method(auth,'ensureAnalyticsIdentity',async(w,c)=>{assert.equal(w,'trusted');assert.equal(c,'olist1');});
  t.mock.method(provider,'olistRequest',async(token,c,path)=>{assert.equal(token,'secret');assert.equal(c,'olist1');assert.equal(path,'/produtos?limit=100&offset=100');return{itens:[{id:101,sku:'A',precos:{precoCusto:5}}],paginacao:{total:101}};});
  assert.deepEqual(await processCostSync(),{processed:1,pending:false});
  assert.equal(calls.length,2);assert.equal(calls[1].name,'analytics_finish_cost_page');
  assert.equal(calls[1].args.p_offset,100);assert.equal(calls[1].args.p_lease,'lease');
  assert.equal(calls[1].args.p_products[0].cost_cents,'500.0000');
  assert.equal(JSON.stringify(calls).includes('secret'),false);
});

test('429 preserves checkpoint and honors Retry-After; missing product permission gives actionable guidance',async t=>{
  const calls=[];
  t.mock.method(admin,'createAdminClient',()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:name==='analytics_claim_cost_sync'?{workspace_id:'w',connection_id:'c',lease:'l',connection_version:1,page_offset:200}:null};}}));
  t.mock.method(auth,'analyticsToken',async()=> 'token');t.mock.method(auth,'ensureAnalyticsIdentity',async()=>{});
  for(const status of [429,403]){
    t.mock.method(provider,'olistRequest',async()=>{throw new provider.AnalyticsApiError(status,123);});
    const result=await processCostSync(),last=calls.at(-1).args;
    assert.equal(result.processed,0);assert.equal(last.p_offset,200);assert.equal(last.p_products,undefined);
    assert.equal(last.p_retry,status===429?123:3600);
    assert.equal(last.p_cooldown,status===429?123:3);
    if(status===403)assert.match(result.error,/leitura de Produtos.*Olist 1.*Ninho/);
  }
});

test('fresh cache or busy account causes no token or Olist request',async t=>{
  t.mock.method(admin,'createAdminClient',()=>({rpc:async()=>({data:null})}));
  t.mock.method(auth,'analyticsToken',async()=>{throw Error('must not run');});
  assert.deepEqual(await processCostSync(),{processed:0});
});
