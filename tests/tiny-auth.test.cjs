require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const admin = require('../src/lib/supabase/admin.ts');
const crypto = require('../src/lib/token-crypto.ts');
const authPath = require.resolve('../src/lib/tiny-auth.ts');
const auth = require(authPath);
const route = require('../src/app/api/internal/olist-token-refresh/route.ts');
const owner = 'owner-a';
const future = ms => new Date(Date.now() + ms).toISOString();
const hours = n => n * 3600000;

function fixture(t, options = {}) {
  t.mock.method(crypto, 'encryptToken', v => 'encrypted:' + v);
  t.mock.method(crypto, 'decryptToken', v => { assert.ok(v.startsWith('encrypted:')); return v.slice(10); });
  const prevId = process.env.TINY_CLIENT_ID, prevSecret = process.env.TINY_CLIENT_SECRET;
  process.env.TINY_CLIENT_ID = 'test-id'; process.env.TINY_CLIENT_SECRET = 'test-secret';
  t.after(() => { for (const [k,v] of [['TINY_CLIENT_ID',prevId],['TINY_CLIENT_SECRET',prevSecret]]) { if(v===undefined) delete process.env[k]; else process.env[k]=v; } });
  const state = { row: { id: 'connection', workspace_id: owner, access_token: 'encrypted:old-access', refresh_token: 'encrypted:old-refresh', expires_at: future(-1000), refresh_expires_at: future(hours(20)), refresh_lock: null, refresh_locked_until: null, ...options.row }, calls: 0, saves: 0, claims: 0 };
  t.mock.method(admin, 'createAdminClient', () => ({ from(table) {
    assert.equal(table, 'tiny_integrations');
    let patch, lease = false; const filters = [];
    const query = {
      select() { return query; }, update(value) { patch = value; return query; },
      eq(k,v) { filters.push([k,v]); return query; }, or() { lease=true; return query; },
      maybeSingle() { return query; }, abortSignal() { return query; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          assert.ok(filters.some(([k,v])=>k==='workspace_id'&&v===owner));
          if (!patch && options.readError) return { data: null, error: { code: 'network' } };
          let matched=state.row&&filters.every(([k,v])=>state.row[k]===v);
          if (lease && state.row.refresh_locked_until && Date.parse(state.row.refresh_locked_until) >= Date.now()) matched=false;
          if (patch?.access_token) {
            state.saves++;
            if (options.failFirstSave && state.saves===1) return { data:null,error:{code:'network'} };
          }
          if (matched && patch) { if(lease)state.claims++; Object.assign(state.row,patch); }
          return { data:matched?{...state.row}:null,error:null };
        }).then(resolve,reject);
      }
    };return query;
  }}));
  t.mock.method(global, 'fetch', async (url, init) => {
    state.calls++;
    assert.match(url,/openid-connect\/token$/);
    assert.equal(init.body.get('grant_type'),'refresh_token');
    assert.equal(init.body.get('refresh_token'),'old-refresh');
    assert.ok(init.signal);
    if(options.onExchange) await options.onExchange(state);
    return Response.json(options.response || { access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 14400, refresh_expires_in: 86400 }, {status:options.status||200});
  });
  return state;
}

test('healthy access token does not make any provider request', async t => {
  const state=fixture(t,{row:{expires_at:future(hours(3))}});
  assert.equal((await auth.getValidTinyToken(owner)).token,'old-access');
  assert.equal(state.calls,0);assert.equal(state.claims,0);
});
test('simultaneous requests rotate once and save the new encrypted pair', async t => {
  const state=fixture(t);
  const results=await Promise.all(Array.from({length:20},()=>auth.getValidTinyToken(owner)));
  assert.ok(results.every(r=>r.status==='refreshed'&&r.token==='new-access'));
  assert.equal(state.calls,1);assert.equal(state.saves,1);assert.equal(state.row.refresh_lock,null);
  assert.equal(state.row.refresh_token,'encrypted:new-refresh');
  assert.ok(Date.parse(state.row.refresh_expires_at)>Date.now()+hours(23));
});
test('database lease serializes rotation across independent server instances', async t => {
  const state=fixture(t,{onExchange:()=>new Promise(resolve=>setTimeout(resolve,40))});
  delete require.cache[authPath];const otherInstance=require(authPath);
  const results=await Promise.all([auth.getValidTinyToken(owner),otherInstance.getValidTinyToken(owner)]);
  assert.ok(results.every(r=>r.token==='new-access'));assert.equal(state.calls,1);assert.equal(state.claims,1);
});
test('database failure and invalid_client never masquerade as an expired authorization', async t => {
  await t.test('storage',async st=>{const s=fixture(st,{readError:true});assert.equal((await auth.getValidTinyToken(owner)).status,'error');assert.equal(s.calls,0);});
  for(const status of [400,401,429,503]) await t.test('provider '+status,async st=>{
    const s=fixture(st,{status,response:{error:status===400||status===401?'invalid_client':'unavailable'}});
    assert.equal((await auth.getValidTinyToken(owner)).status,'error');assert.equal(s.saves,0);assert.equal(s.row.refresh_lock,null);
  });
});
test('invalid_grant requires reconnection but an expired refresh does not discard usable access', async t => {
  await t.test('revoked',async st=>{fixture(st,{status:400,response:{error:'invalid_grant'}});assert.equal((await auth.getValidTinyToken(owner)).status,'expired');});
  await t.test('still usable',async st=>{const s=fixture(st,{row:{expires_at:future(hours(1)),refresh_expires_at:future(-1000)}});const result=await auth.getValidTinyToken(owner);assert.equal(result.token,'old-access');assert.ok(result.message);assert.equal(s.calls,0);});
  await t.test('both expired',async st=>{const s=fixture(st,{row:{refresh_expires_at:future(-1000)}});assert.equal((await auth.getValidTinyToken(owner)).status,'expired');assert.equal(s.calls,0);});
});
test('refresh nearing expiry is renewed even while the access token is still valid',async t=>{
  const s=fixture(t,{row:{expires_at:future(hours(3)),refresh_expires_at:future(hours(2))}});
  assert.equal((await auth.getValidTinyToken(owner)).status,'refreshed');assert.equal(s.calls,1);
});
test('failed persistence retries the same token pair without a second provider exchange',async t=>{
  const s=fixture(t,{failFirstSave:true});assert.equal((await auth.getValidTinyToken(owner)).status,'refreshed');
  assert.equal(s.calls,1);assert.equal(s.saves,2);
});
test('a reconnect during refresh cannot be overwritten by the older request',async t=>{
  const s=fixture(t,{onExchange:state=>Object.assign(state.row,{refresh_token:'encrypted:user-reconnected',access_token:'encrypted:user-access',refresh_lock:null,refresh_locked_until:null})});
  assert.equal((await auth.getValidTinyToken(owner)).status,'error');assert.equal(s.row.refresh_token,'encrypted:user-reconnected');
});
test('missing refresh expiry retains the previous deadline and malformed responses preserve credentials',async t=>{
  await t.test('omitted deadline',async st=>{const s=fixture(st,{response:{access_token:'new-access',refresh_token:'new-refresh',expires_in:14400}});const deadline=s.row.refresh_expires_at;assert.equal((await auth.getValidTinyToken(owner)).status,'refreshed');assert.equal(s.row.refresh_expires_at,deadline);});
  await t.test('malformed',async st=>{const s=fixture(st,{response:{access_token:'broken',expires_in:14400}});assert.equal((await auth.getValidTinyToken(owner)).status,'error');assert.equal(s.row.access_token,'encrypted:old-access');assert.equal(s.saves,0);});
});

test('cron rejects unauthorized requests and only renews due integrations without order requests',async t=>{
  const old=process.env.CRON_SECRET;process.env.CRON_SECRET='cron-test-secret';t.after(()=>{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;});
  assert.equal((await route.POST(new Request('https://example.test/api/internal/olist-token-refresh',{method:'POST'}))).status,401);
  let renewed=0;
  t.mock.method(auth,'getValidTinyToken',async(id,margin)=>{assert.equal(id,owner);assert.equal(margin,65*60000);renewed++;return{status:'refreshed',token:'private'};});
  t.mock.method(admin,'createAdminClient',()=>({from(){const q={select(){return q},not(){return q},or(filter){assert.match(filter,/expires_at.lte/);return q},order(){return q},limit(){return q},abortSignal(){return Promise.resolve({data:[{workspace_id:owner}],error:null})}};return q;}}));
  t.mock.method(global,'fetch',()=>{throw Error('must not query orders')});
  const request=()=>new Request('https://example.test/api/internal/olist-token-refresh',{method:'POST',headers:{Authorization:'Bearer cron-test-secret'}});
  const response=await route.POST(request());assert.equal(response.status,200);assert.equal(renewed,1);
  const body=await response.text();assert.ok(!body.includes('private'));assert.ok(!body.includes(owner));
  t.mock.method(auth,'getValidTinyToken',async()=>({status:'expired',token:null}));
  assert.equal((await route.POST(request())).status,503);
});
