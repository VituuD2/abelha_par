require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/lib/auth.ts');
const admin = require('../src/lib/supabase/admin.ts');
const access = require('../src/lib/access.ts');
const olist = require('../src/lib/olist.ts');
const sync = require('../src/lib/olist-sync.ts');
const tiny = require('../src/lib/tiny-auth.ts');
const shop = require('../src/lib/nuvemshop.ts');
const olistRoute = require('../src/app/api/olist/route.ts');
const mutations = [
  [require('../src/app/api/auth/login/route.ts'), 'GET'],
  [require('../src/app/api/auth/callback/route.ts'), 'GET'],
  [require('../src/app/api/auth/disconnect/route.ts'), 'POST'],
  [require('../src/app/api/nuvemshop/connection/route.ts'), 'POST'],
  [require('../src/app/api/nuvemshop/connection/route.ts'), 'PATCH'],
  [require('../src/app/api/nuvemshop/connection/route.ts'), 'DELETE'],
  [require('../src/app/api/ninho/users/route.ts'), 'GET'],
  [require('../src/app/api/ninho/users/route.ts'), 'POST'],
  [require('../src/app/api/ninho/users/route.ts'), 'PATCH'],
  [require('../src/app/api/ninho/webhook/route.ts'), 'GET'],
  [require('../src/app/api/ninho/webhook/route.ts'), 'POST'],
];

function membership(t, { role = 'operator', active = true, user = { id: 'operator-id', user_metadata: { role: 'admin' } }, error = null } = {}) {
  t.mock.method(auth,'getAuthenticatedUser',async()=>user);
  t.mock.method(admin,'createAdminClient',()=>({from(table){
    assert.equal(table,'workspace_members','denied requests must never reach credential or user mutations');
    const query={select(){return query},eq(key,value){assert.equal(key,'user_id');assert.equal(value,user.id);return query},async maybeSingle(){return{data:{workspace_id:'shared-store-id',role,active,display_name:'Operador'},error}}};
    return query;
  }}));
}

test('operators cannot access Ninho or mutate any connection, even with forged user metadata',async t=>{
  membership(t);
  for (const [route,method] of mutations) {
    const response=await route[method](new Request('https://app.test/api',{method:method==='GET'?'GET':'POST',body:method==='GET'?undefined:'{}'}));
    assert.equal(response.status,403);
  }
});
test('blocked sessions and missing membership storage fail closed',async t=>{
  membership(t,{active:false});
  assert.equal((await access.authorize()).response.status,403);
  membership(t,{error:{message:'missing table'}});
  assert.equal((await access.authorize()).response.status,503);
  membership(t,{user:null});
  assert.equal((await access.authorize()).response.status,401);
});
test('an active operator fetches orders through workspace credentials and shares their cache',async t=>{
  membership(t);
  t.mock.method(tiny,'getValidTinyToken',async id=>{assert.equal(id,'shared-store-id');return{token:'private',status:'valid'}});
  t.mock.method(shop,'getNuvemshopConnection',async id=>{assert.equal(id,'shared-store-id');return null});
  t.mock.method(olist,'fetchOlistOrdersPage',async options=>{assert.equal(options.token,'private');return{orders:[],nextCursor:null}});
  t.mock.method(sync,'cacheOlistOrders',async id=>assert.equal(id,'shared-store-id'));
  const response=await olistRoute.POST(new Request('https://app.test/api/olist',{method:'POST',body:JSON.stringify({dateFrom:'2026-10-01',dateMode:'created'})}));
  assert.equal(response.status,200);assert.ok(!(await response.text()).includes('private'));
});
test('webhook signatures retain the old URL initially and reject it after rotation',async t=>{
  const secret=process.env.OLIST_WEBHOOK_SECRET;
  process.env.OLIST_WEBHOOK_SECRET='test-secret-that-is-longer-than-thirty-two-characters';
  t.after(()=>{if(secret===undefined)delete process.env.OLIST_WEBHOOK_SECRET;else process.env.OLIST_WEBHOOK_SECRET=secret});
  const webhook=require('../src/lib/olist-webhook.ts');
  const original=webhook.getOlistWebhookSignature('shared-store');
  assert.equal(webhook.isValidOlistWebhookSignature('shared-store',original,0),true);
  assert.equal(webhook.isValidOlistWebhookSignature('shared-store',original,1),false);
  const rotated=webhook.getOlistWebhookSignature('shared-store',1);
  assert.equal(webhook.isValidOlistWebhookSignature('shared-store',rotated,1),true);
});

test('admin creates an account and membership in the current workspace without returning its password',async t=>{
  const route=require('../src/app/api/ninho/users/route.ts');
  t.mock.method(access,'authorize',async()=>({access:{user:{id:'admin-id'},workspaceId:'store-id',role:'admin'}}));
  let created,joined;
  t.mock.method(admin,'createAdminClient',()=>({auth:{admin:{async createUser(value){created=value;return{data:{user:{id:'new-user-id'}},error:null}}}},async rpc(name,values){assert.equal(name,'add_workspace_member');joined=values;return{error:null}}}));
  const response=await route.POST(new Request('https://app.test/api/ninho/users',{method:'POST',body:JSON.stringify({name:' Operador ',email:' User@Example.com ',password:'initial-test-password',role:'operator'})}));
  assert.equal(response.status,201);assert.equal(created.email,'user@example.com');assert.equal(created.email_confirm,true);
  assert.deepEqual(joined,{p_workspace:'store-id',p_actor:'admin-id',p_user:'new-user-id',p_name:'Operador',p_role:'operator'});
  assert.ok(!(await response.text()).includes('initial-test-password'));
});

test('failed membership creation rolls back the new account and malformed bodies are rejected before creating it',async t=>{
  const route=require('../src/app/api/ninho/users/route.ts');
  t.mock.method(access,'authorize',async()=>({access:{user:{id:'admin-id'},workspaceId:'store-id',role:'admin'}}));
  let creates=0,removed;
  t.mock.method(admin,'createAdminClient',()=>({auth:{admin:{async createUser(){creates++;return{data:{user:{id:'new-user-id'}},error:null}},async deleteUser(id){removed=id;return{error:null}}}},async rpc(){return{error:{message:'storage unavailable'}}}}));
  for(const body of [null,[],{name:'Operador',email:'a@example.com',password:'short',role:'admin'}]) {
    assert.equal((await route.POST(new Request('https://app.test/api/ninho/users',{method:'POST',body:JSON.stringify(body)}))).status,400);
  }
  assert.equal(creates,0);
  const response=await route.POST(new Request('https://app.test/api/ninho/users',{method:'POST',body:JSON.stringify({name:'Operador',email:'a@example.com',password:'initial-test-password',role:'operator'})}));
  assert.equal(response.status,503);assert.equal(removed,'new-user-id');assert.equal(creates,1);
});
