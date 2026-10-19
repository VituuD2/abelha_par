require('./setup.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const access=require('../src/lib/access.ts');
const server=require('../src/lib/supabase/server.ts');
const route=require('../src/app/api/batches/route.ts');
const ws='10000000-0000-4000-8000-000000000001';
function fixture(t,result={data:{batches:[],total:0,matchingOrders:0},error:null}){
  const calls=[];
  t.mock.method(access,'authorize',async()=>({access:{workspaceId:ws,user:{id:'trusted-user'},role:'operator'}}));
  t.mock.method(server,'createClient',async()=>({
    rpc(name,args){calls.push({rpc:name,args});return{abortSignal:async()=>result};},
    from(table){const call={table,eq:[],order:[]};calls.push(call);const chain={
      select(fields,options){call.fields=fields;call.options=options;return chain;},
      eq(key,value){call.eq.push([key,value]);return chain;},
      order(key,options){call.order.push([key,options]);return chain;},
      range(from,to){call.range=[from,to];return chain;},
      abortSignal:async()=>result,
    };return chain;},
  }));return calls;
}
test('history search binds workspace on the server, passes literal query and returns paginated matches without caching',async t=>{
  const data={batches:[{id:'old',matchedOrders:[{clientName:'João'}]}],total:42,matchingOrders:80};
  const calls=fixture(t,{data,error:null});
  const r=await route.GET(new Request('http://localhost/api/batches?q=Jo%C3%A3o%25_&page=2&workspace=forged'));
  assert.equal(r.status,200);assert.match(r.headers.get('Cache-Control'),/no-store/);
  assert.deepEqual(calls,[{rpc:'search_workspace_batches',args:{p_workspace:ws,p_query:'João%_',p_offset:20,p_limit:20}}]);
  assert.deepEqual(await r.json(),{...data,page:2,size:20});
});
test('blank search browses all saved batches with stable pagination and the same workspace restriction',async t=>{
  const calls=fixture(t,{data:[{id:'batch'}],count:65,error:null});
  const r=await route.GET(new Request('http://localhost/api/batches?q=%20%20&page=3'));
  assert.equal(r.status,200);assert.deepEqual(calls[0].range,[40,59]);
  assert.deepEqual(calls[0].eq,[['workspace_id',ws]]);
  assert.deepEqual(calls[0].order.map(([key])=>key),['created_at','id']);
  assert.deepEqual(await r.json(),{batches:[{id:'batch'}],total:65,page:3,size:20});
});
test('missing search migration is actionable and does not silently restrict search to recent batches',async t=>{
  fixture(t,{data:null,error:{code:'PGRST202'}});
  const r=await route.GET(new Request('http://localhost/api/batches?q=7925'));
  assert.equal(r.status,503);assert.match((await r.json()).error,/migração v17/);
});
test('invalid inputs and denied membership never query batches',async t=>{
  const calls=fixture(t);
  for(const suffix of ['?page=0','?page=-1','?page=1.2','?page=100001','?q='+ 'x'.repeat(201)])
    assert.equal((await route.GET(new Request('http://localhost/api/batches'+suffix))).status,400);
  assert.equal(calls.length,0);
  t.mock.method(access,'authorize',async()=>({response:Response.json({error:'Bloqueado'},{status:403})}));
  assert.equal((await route.GET(new Request('http://localhost/api/batches?q=nome'))).status,403);
  assert.equal(calls.length,0);
});
