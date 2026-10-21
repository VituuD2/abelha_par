require('./setup.cjs');
const {test}=require('node:test'),assert=require('node:assert/strict');
const {connectionHealth,operationalHealth}=require('../src/lib/connection-status.ts');
const now=Date.parse('2026-10-21T13:00:00Z');
const connected={enabled:true,credential_kind:'oauth',client_id:'app',expires_at:'2026-10-21T12:00:00Z',refresh_expires_at:'2026-10-22T12:00:00Z',verified_at:'2026-10-20T12:00:00Z'};

test('access expiry and transient import errors do not demand reconnection while refresh remains valid',()=>{
  for(const last_error of [null,'Limite da API Olist atingido','Controle de consultas indisponível','HTTP 503']) {
    const health=connectionHealth({...connected,last_error},now);
    assert.equal(health.code,'connected');assert.equal(health.action,null);
  }
});
test('authorization, identity and permission failures each have a distinct status and recovery',()=>{
  assert.equal(connectionHealth({...connected,error_code:'authorization_required'},now).action,'reconnect');
  assert.equal(connectionHealth({...connected,refresh_expires_at:'2026-10-21T12:59:59Z'},now).action,'reconnect');
  assert.equal(connectionHealth({...connected,error_code:'permission_required'},now).code,'permission_required');
  assert.equal(connectionHealth({...connected,error_code:'permission_required'},now).action,null);
  assert.equal(connectionHealth({...connected,error_code:'identity_mismatch'},now).action,'verify');
  assert.equal(connectionHealth({...connected,enabled:false,error_code:'authorization_required'},now).code,'paused');
  assert.equal(connectionHealth({...connected,expires_at:null},now).action,'authorize');
  assert.equal(connectionHealth({...connected,client_id:null},now).action,'configure');
});
test('healthy legacy links require no repair, while deleted links cannot fall through to OAuth',()=>{
  const legacy={...connected,credential_kind:'legacy',client_id:null,legacy_integration_id:'integration'};
  assert.equal(connectionHealth(legacy,now).action,null);
  assert.equal(connectionHealth({...legacy,legacy_integration_id:null},now).action,'relink');
});
test('operational status distinguishes missing, expired, denied and temporary failure',()=>{
  assert.equal(operationalHealth({isConnected:true,status:'valid'}).action,null);
  assert.equal(operationalHealth({isConnected:false,status:'error'}).code,'unavailable');
  assert.equal(operationalHealth({isConnected:false,status:'error'}).action,null);
  assert.equal(operationalHealth({isConnected:false,status:'missing'}).action,'authorize');
  assert.equal(operationalHealth({isConnected:false,needsReconnect:true,status:'expired'}).action,'reconnect');
  assert.equal(operationalHealth({isConnected:false,status:'access_denied'}).code,'permission_required');
  assert.equal(operationalHealth({isConnected:true,status:'valid',needsReconnect:true}).label,'Renovação expirada');
  assert.equal(operationalHealth({isConnected:true,status:'valid',needsReconnect:true}).action,'reconnect');
});
