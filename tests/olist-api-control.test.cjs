require('./setup.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const admin=require('../src/lib/supabase/admin.ts'),access=require('../src/lib/access.ts');
const control=require('../src/lib/olist-api-control.ts');
const route=require('../src/app/api/analytics/api-usage/route.ts');
const provider=require('../src/lib/analytics/olist-client.ts');
const operational=require('../src/lib/olist.ts');
function database(t, handler){
 const calls=[];t.mock.method(admin,'createAdminClient',()=>({rpc(name,args){calls.push({name,args});const promise=Promise.resolve().then(()=>handler(name,args));promise.abortSignal=()=>promise;return promise;}}));return calls;
}
function clock(t){let at=1800000000000;t.mock.method(Date,'now',()=>at);t.mock.method(global,'setTimeout',(fn,ms)=>{at+=ms;queueMicrotask(fn);});return()=>at;}
test('distributed acquire waits and rechecks before dispatch, without exposing credentials to SQL',async t=>{
 const now=clock(t);let grants=0;
 const calls=database(t,(name)=>({data:++grants===1?{granted:false,wait_ms:1000}:{granted:true},error:null}));
 const start=now(),permit=await control.acquireOlistPermit({connectionId:'trusted'},'orders',false,now()+20000);
 assert.equal(now()-start,1000);assert.ok(permit.id);assert.equal(calls.length,2);
 assert.equal(calls[0].args.p_request,calls[1].args.p_request);
 assert.equal(calls[0].args.p_connection,'trusted');assert.equal(calls[0].args.p_workspace,null);
});
test('an unavailable gate prevents the provider call and long cooldowns preserve the remaining worker budget',async t=>{
 const now=clock(t);let http=0;t.mock.method(global,'fetch',async()=>{http++;return Response.json({});});
 database(t,()=>({data:null,error:{code:'PGRST000'}}));
 await assert.rejects(provider.olistRequest('private-token','c','/pedidos'),/chamada adiada/);assert.equal(http,0);
 database(t,()=>({data:{granted:false,wait_ms:60000},error:null}));
 await assert.rejects(control.acquireOlistPermit({connectionId:'c'},'orders',false,now()+20000),e=>e instanceof control.OlistQuotaWait&&e.retryAfterSeconds===60);
 assert.equal(http,0);
});
test('analytics and operational HTTP clients use the same gate and record only numeric rate headers',async t=>{
 const calls=database(t,()=>({data:{granted:true},error:null}));
 t.mock.method(global,'fetch',async url=>Response.json(url.includes('/info')?{id:1}:{itens:[],paginacao:{total:0}},
  {headers:{'X-RateLimit-Limit':'120','X-RateLimit-Remaining':'85','X-RateLimit-Reset':'12','private-header':'secret'}}));
 await provider.olistRequest('private-token','connection','/info');
 await operational.fetchOlistOrdersPage({token:'private-token',workspaceId:'workspace',dateFrom:'2026-10-20'});
 const grants=calls.filter(c=>c.name==='olist_api_acquire'),records=calls.filter(c=>c.name==='olist_api_record');
 assert.deepEqual(grants.map(c=>c.args.p_source),['identity','operational']);
 assert.equal(grants[0].args.p_connection,'connection');assert.equal(grants[1].args.p_workspace,'workspace');
 assert.equal(records.length,2);assert.equal(records[0].args.p_limit,120);assert.equal(records[0].args.p_remaining,85);assert.equal(records[0].args.p_reset,12);
 assert.equal(JSON.stringify(calls).includes('private-token'),false);assert.equal(JSON.stringify(calls).includes('private-header'),false);
});
test('telemetry failures cannot turn a successful order read into a new HTTP retry',async t=>{
 let http=0;database(t,name=>name==='olist_api_record'?{error:{code:'offline'}}:{data:{granted:true},error:null});
 t.mock.method(console,'warn',()=>{});t.mock.method(global,'fetch',async()=>{http++;return Response.json({id:7});});
 assert.equal((await provider.olistRequest('private-token','c','/pedidos/7')).id,7);assert.equal(http,1);
});
test('monitor API requires management access and derives workspace/actor exclusively from the session',async t=>{
 let calls=0;t.mock.method(access,'authorize',async permission=>{assert.equal(permission,'integrations:manage');return{response:new Response('{}',{status:403})};});
 t.mock.method(control,'olistApiUsage',async()=>{calls++;return{available:true};});assert.equal((await route.GET()).status,403);assert.equal(calls,0);
 t.mock.method(access,'authorize',async()=>({access:{workspaceId:'trusted-workspace',user:{id:'trusted-user'}}}));
 t.mock.method(control,'olistApiUsage',async(w,a)=>{assert.equal(w,'trusted-workspace');assert.equal(a,'trusted-user');return{available:true,accounts:[]};});
 const response=await route.GET();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
});
test('unknown or missing rate headers stay unknown rather than displaying zero consumption',async t=>{
 const calls=database(t,()=>({data:null,error:null}));
 await control.recordOlistResult({id:'permit',waitMs:0},200,50,'http',new Headers({'x-ratelimit-limit':'not-a-number','x-ratelimit-remaining':'','x-ratelimit-reset':'1800000012'}));
 const args=calls[0].args;assert.equal(args.p_limit,null);assert.equal(args.p_remaining,null);assert.equal(args.p_reset,null);
});
test('a local scheduled quota wait is not reported as an HTTP limit reached at Olist',async t=>{
 const now=clock(t);let requests=0;
 database(t,()=>({data:{granted:false,wait_ms:60000},error:null}));
 t.mock.method(global,'fetch',async()=>{requests++;return Response.json({});});
 await assert.rejects(provider.olistRequest('private','c','/pedidos',{deadlineMs:now()+20000}),e=>
   e instanceof provider.AnalyticsQuotaWait&&e.retryAfter===60&&/Aguardando cota/.test(e.message)&&!/atingido/.test(e.message));
 assert.equal(requests,0);
});

test('missing migration preserves the previous pace and cannot activate accelerated limits',async t=>{
 const now=clock(t);t.mock.method(console,'warn',()=>{});
 database(t,()=>({data:null,error:{code:'PGRST202'}}));
 const first=await control.acquireOlistPermit({connectionId:'unknown-migration'},'orders',false,now()+30000);
 const start=now(),second=await control.acquireOlistPermit({connectionId:'unknown-migration'},'orders',false,now()+30000);
 assert.equal(first.id,null);assert.equal(second.id,null);assert.equal(now()-start,2100);
});
