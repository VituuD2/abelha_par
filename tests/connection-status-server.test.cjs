require('./setup.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const admin=require('../src/lib/supabase/admin.ts');
const costs=require('../src/lib/analytics/cost-sync.ts');
const access=require('../src/lib/access.ts');
const tiny=require('../src/lib/tiny-auth.ts');
const provider=require('../src/lib/olist.ts');
const {analyticsStatus}=require('../src/lib/analytics/server.ts');
const statusRoute=require('../src/app/api/auth/status/route.ts');

test('server resolves the actual legacy link with metadata only and never mislabels failed reads as disconnection',async t=>{
  const c={id:'c',workspace_id:'w',name:'Olist',enabled:true,credential_kind:'legacy',legacy_integration_id:'integration',verified_at:'2026-10-20'};
  const fields=[];let legacyError=null,legacyId='integration';
  t.mock.method(costs,'costSyncStatus',async()=>null);
  t.mock.method(admin,'createAdminClient',()=>({
    rpc:async()=>({data:[],error:null}),
    from(table){
      const chain={select(value){fields.push({table,value});return chain;},eq(key,value){assert.equal(key,'workspace_id');assert.equal(value,'w');return chain;},order(){return chain;},maybeSingle(){return chain;},then(resolve){return Promise.resolve({
        data:table==='analytics_connections'?[c]:table==='tiny_integrations'?{id:legacyId,expires_at:'2099-01-01',refresh_expires_at:'2099-01-01'}:[],
        error:table==='tiny_integrations'?legacyError:null,
      }).then(resolve);}};return chain;
    },
  }));
  let result=await analyticsStatus('w','actor');assert.equal(result.connections[0].health.code,'connected');
  legacyId='replacement';result=await analyticsStatus('w','actor');assert.equal(result.connections[0].health.action,'relink');
  legacyError={code:'PGRST000'};result=await analyticsStatus('w','actor');assert.equal(result.connections[0].health.code,'unavailable');assert.equal(result.connections[0].health.action,null);
  c.enabled=false;result=await analyticsStatus('w','actor');assert.equal(result.connections[0].health.code,'paused');
  assert.ok(fields.every(({value})=>!/(^|,)(access_token|refresh_token|client_secret)(,|$)/.test(value)));
});

test('operational status publishes the same health contract and a temporary failure does not request reconnection',async t=>{
  t.mock.method(access,'authorize',async()=>({access:{workspaceId:'status-contract',role:'admin',user:{id:'actor'}}}));
  t.mock.method(provider,'testTinyConnection',()=>{throw Error('normal status must not call the orders API');});
  for(const [status,token,expected] of [['valid','access','connected'],['error',null,'unavailable'],['missing',null,'authorization_required'],['expired',null,'authorization_required']]){
    t.mock.method(tiny,'getValidTinyToken',async()=>({token,status}));
    const response=await statusRoute.GET(new Request('http://localhost/api/auth/status'));
    const body=await response.json();assert.equal(body.health.code,expected);
    assert.equal(body.needsReconnect,status==='expired');
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    if(status==='error')assert.equal(body.health.action,null);
  }
  t.mock.method(tiny,'getValidTinyToken',async()=>({token:'still-usable',status:'valid',needsReconnect:true}));
  const expiring=await (await statusRoute.GET(new Request('http://localhost/api/auth/status'))).json();
  assert.equal(expiring.isConnected,true);assert.equal(expiring.needsReconnect,true);assert.equal(expiring.health.label,'Renovação expirada');
});
