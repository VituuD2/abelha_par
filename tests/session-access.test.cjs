require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionAccessMonitor } = require('../src/lib/session-access.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b}); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve=>setImmediate(resolve));

test('switching from admin to operator removes privileges immediately and ignores the old account response',async()=>{
  const initial=deferred(),stale=deferred(),operator=deferred();
  const pending=[initial,stale,operator];let snapshot;
  const monitor=createSessionAccessMonitor(()=>pending.shift().promise,next=>snapshot=next);
  monitor.observeSession('admin');
  assert.equal(snapshot.role,null);
  initial.resolve({userId:'admin',role:'admin'});await settle();
  assert.equal(snapshot.role,'admin');
  const oldRequest=monitor.refresh();
  monitor.observeSession('operator');
  assert.equal(snapshot.userId,'operator');assert.equal(snapshot.role,null);assert.equal(snapshot.loading,true);
  operator.resolve({userId:'operator',role:'operator'});await settle();
  stale.resolve({userId:'admin',role:'admin'});await oldRequest;
  assert.equal(snapshot.role,'operator');assert.equal(snapshot.userId,'operator');
  monitor.dispose();
});

test('a late admin response cannot reverse the latest role update for the same account',async()=>{
  const initial=deferred(),stale=deferred(),latest=deferred();
  const pending=[initial,stale,latest];let snapshot;
  const monitor=createSessionAccessMonitor(()=>pending.shift().promise,next=>snapshot=next);
  monitor.observeSession('same-user');initial.resolve({userId:'same-user',role:'admin'});await settle();
  const older=monitor.refresh(),newer=monitor.refresh();
  latest.resolve({userId:'same-user',role:'operator'});await newer;
  stale.resolve({userId:'same-user',role:'admin'});await older;
  assert.equal(snapshot.role,'operator');monitor.dispose();
});

test('logout, mismatched identities and failed permission checks cannot keep the admin menu',async()=>{
  const first=deferred(),late=deferred();const pending=[first,late];let snapshot;
  const monitor=createSessionAccessMonitor(()=>pending.shift().promise,next=>snapshot=next);
  monitor.observeSession('admin');first.resolve({userId:'admin',role:'admin'});await settle();
  const old=monitor.refresh();monitor.observeSession(null);
  late.resolve({userId:'admin',role:'admin'});await old;
  assert.equal(snapshot.userId,null);assert.equal(snapshot.role,null);
  monitor.dispose();

  const mismatched=createSessionAccessMonitor(async()=>({userId:'old-admin',role:'admin'}),next=>snapshot=next);
  mismatched.observeSession('operator');await settle();
  assert.equal(snapshot.role,null);assert.ok(snapshot.error);mismatched.dispose();
  const offline=createSessionAccessMonitor(async()=>{throw new Error('offline')},next=>snapshot=next);
  offline.observeSession('admin');await settle();
  assert.equal(snapshot.role,null);assert.equal(snapshot.error,'offline');offline.dispose();
});

test('unmount discards pending responses instead of updating a new login',async()=>{
  const request=deferred();let updates=0;
  const monitor=createSessionAccessMonitor(()=>request.promise,()=>updates++);
  monitor.observeSession('admin');const before=updates;monitor.dispose();
  request.resolve({userId:'admin',role:'admin'});await settle();assert.equal(updates,before);
});
