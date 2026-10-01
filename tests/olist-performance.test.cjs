require('./setup.cjs');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const auth=require('../src/lib/access.ts');
const admin=require('../src/lib/supabase/admin.ts');
const server=require('../src/lib/supabase/server.ts');
const tinyAuth=require('../src/lib/tiny-auth.ts');
const nuvemshop=require('../src/lib/nuvemshop.ts');
const olist=require('../src/lib/olist.ts');
const sync=require('../src/lib/olist-sync.ts');
const route=require('../src/app/api/olist/route.ts');
const statusRoute=require('../src/app/api/auth/status/route.ts');
const owner='olist-test-owner';
const mapping={ecommerceId:23257,referenceKind:'number',referenceField:'ecommerceOrderNumber'};
const item=id=>({id,numeroPedido:id,situacao:1,cliente:{nome:'Teste'},ecommerce:{id:23257,numeroPedidoEcommerce:String(id),numeroPedidoCanalVenda:null},transportador:{codigoRastreamento:id===1?null:'TRACK-'+id}});

test('100 complete list records require one provider call and are cached server-side before returning',async t=>{
  t.mock.method(auth,'authorize',async()=>({access:{user:{id:owner},workspaceId:owner,role:'operator'}}));
  t.mock.method(tinyAuth,'getValidTinyToken',async()=>({token:'test',status:'valid'}));
  t.mock.method(nuvemshop,'getNuvemshopConnection',async()=>({mapping}));
  let calls=0,saved;
  t.mock.method(global,'fetch',async url=>{calls++;assert.equal(new URL(url).pathname,'/public-api/v3/pedidos');return Response.json({itens:Array.from({length:100},(_,i)=>item(i+1)),paginacao:{total:100}})});
  t.mock.method(admin,'createAdminClient',()=>({from(table){assert.equal(table,'olist_order_cache');return{async upsert(rows,options){saved=rows;assert.equal(options.onConflict,'workspace_id,olist_order_id');return{error:null}}}}}));
  const response=await route.POST(new Request('http://localhost/api/olist',{method:'POST',body:JSON.stringify({dateFrom:'2026-10-01',dateTo:'2026-10-01',dateMode:'created'})}));
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(calls,1);assert.equal(body.orders.length,100);assert.ok(body.orders.every(o=>!o.needsDetail));
  assert.equal(saved.length,100);assert.ok(saved.every(r=>r.workspace_id===owner&&Date.parse(r.resolved_at)>Date.now()-1000));
  assert.equal(saved[0].tracking_code,'');assert.equal(saved[1].tracking_code,'TRACK-2');assert.equal(saved[1].ecommerce_order_number,'2');
});
test('omitted fields trigger detail fallback; explicit null tracking is a valid fresh snapshot',async t=>{
  const partial=item(2);delete partial.transportador.codigoRastreamento;
  const noStatus=item(3);delete noStatus.situacao;
  t.mock.method(global,'fetch',async()=>Response.json({itens:[item(1),partial,noStatus],paginacao:{total:3}}));
  const page=await olist.fetchOlistOrdersPage({token:'test',dateFrom:'2026-10-01',ecommerceId:23257});
  assert.deepEqual(page.orders.map(o=>o.needsDetail),[false,true,true]);
  t.mock.method(admin,'createAdminClient',()=>({from(){return{async upsert(rows){assert.deepEqual(rows.map(r=>r.olist_order_id),[1]);return{error:null}}}}}));
  await sync.cacheOlistOrders(owner,page.orders);
});
test('a cache write failure prevents a successful preparation response',async t=>{
  t.mock.method(auth,'authorize',async()=>({access:{user:{id:owner},workspaceId:owner,role:'operator'}}));
  t.mock.method(tinyAuth,'getValidTinyToken',async()=>({token:'test',status:'valid'}));
  t.mock.method(nuvemshop,'getNuvemshopConnection',async()=>({mapping}));
  t.mock.method(olist,'fetchOlistOrdersPage',async()=>({orders:[olist.normalizeOlistOrder(item(1))],nextCursor:null}));
  t.mock.method(admin,'createAdminClient',()=>({from(){return{async upsert(){return{error:{code:'offline'}}}}}}));
  t.mock.method(console,'error',()=>{});
  const response=await route.POST(new Request('http://localhost/api/olist',{method:'POST',body:JSON.stringify({dateFrom:'2026-10-01',dateMode:'created'})}));
  assert.equal(response.status,502);
});
test('operational connection status uses shared credentials without exposing webhook URL or tokens',async t=>{
  t.mock.method(auth,'authorize',async()=>({access:{user:{id:'operator-user'},workspaceId:owner,role:'operator'}}));
  t.mock.method(tinyAuth,'getValidTinyToken',async workspace=>{assert.equal(workspace,owner);return{token:'private-token',status:'valid'}});
  t.mock.method(global,'fetch',()=>{throw Error('unnecessary provider request')});
  const response=await statusRoute.GET(new Request('http://localhost/api/auth/status'));
  assert.equal(response.status,200);
  const text=await response.text(),body=JSON.parse(text);
  assert.equal(body.isConnected,true);assert.ok(!text.includes('private-token'));
  assert.equal(body.webhookUrl,undefined);
  assert.equal((await statusRoute.GET(new Request('http://localhost/api/auth/status?verify=1'))).status,403);
});
