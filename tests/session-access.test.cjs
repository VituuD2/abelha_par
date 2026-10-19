require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionAccessMonitor } = require('../src/lib/session-access.ts');
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b}); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve=>setImmediate(resolve));
const admin = { userId:'user', role:'admin' };

test('server bootstrap and repeated same-identity auth/focus events reuse a fresh snapshot without publishing or fetching',async()=>{
  let now=100,loads=0,publishes=0;
  const monitor=createSessionAccessMonitor(async()=>{loads++;return admin},()=>publishes++,{initialAccess:admin,initialScope:'/',now:()=>now});
  for(let i=0;i<20;i++){
    monitor.observeSession('user','/');
    await monitor.refresh('/');
  }
  now+=59_999;await monitor.refresh('/');
  assert.equal(loads,0);assert.equal(publishes,0);
  now++;await monitor.refresh('/');
  assert.equal(loads,1);assert.equal(publishes,0,'unchanged permissions do not rerender the app');
  monitor.dispose();
});

test('expired focus, visibility, timer and auth events share one request while the admin menu stays visible',async()=>{
  let now=0,loads=0,snapshot;const request=deferred();
  const monitor=createSessionAccessMonitor(()=>{loads++;return request.promise},next=>snapshot=next,{now:()=>now});
  monitor.observeSession('user','/');await settle();
  assert.equal(snapshot.loading,true);assert.equal(loads,1);
  request.resolve(admin);await settle();
  const next=deferred();
  monitor.dispose();snapshot={...snapshot};
  const current=createSessionAccessMonitor(()=>{loads++;return next.promise},value=>snapshot=value,{initialAccess:admin,initialScope:'/',now:()=>now});
  now=60_000;
  const first=current.refresh('/');
  const second=current.refresh('/');current.observeSession('user','/');
  assert.equal(first,second);await settle();
  assert.equal(loads,2);assert.equal(snapshot.role,'admin');assert.equal(snapshot.loading,false);
  next.resolve(admin);await first;assert.equal(snapshot.role,'admin');
  current.dispose();
});

test('switching identities immediately clears privileges, cancels the old request and ignores its response',async()=>{
  const stale=deferred(),operator=deferred();let snapshot,signal;
  const queue=[stale,operator];
  const monitor=createSessionAccessMonitor(s=>{signal=s;return queue.shift().promise},next=>snapshot=next,{initialAccess:admin});
  const old=monitor.refresh('/',{force:true});await settle();const oldSignal=signal;
  monitor.observeSession('operator','/');
  assert.equal(snapshot.userId,'operator');assert.equal(snapshot.role,null);assert.equal(snapshot.loading,true);
  assert.equal(oldSignal.aborted,true);await settle();
  operator.resolve({userId:'operator',role:'operator'});await settle();
  stale.resolve(admin);await old;
  assert.equal(snapshot.role,'operator');assert.equal(snapshot.userId,'operator');
  monitor.dispose();
});

test('protected route entry always verifies again even with fresh admin permissions',async()=>{
  const pending=deferred();let snapshot;
  const monitor=createSessionAccessMonitor(()=>pending.promise,next=>snapshot=next,{initialAccess:admin,initialScope:'/'});
  const check=monitor.refresh('/ninho',{invalidate:true});
  assert.equal(snapshot.role,'admin','menu is stable while protected content waits');
  assert.equal(snapshot.verifiedFor,null);
  pending.resolve({userId:'user',role:'operator'});await check;
  assert.equal(snapshot.role,'operator');assert.equal(snapshot.verifiedFor,'/ninho');
  monitor.dispose();
});

test('protected entry supersedes background checks and an old response cannot verify the new route',async()=>{
  const old=deferred(),latest=deferred();const queue=[old,latest];let snapshot;
  const monitor=createSessionAccessMonitor(()=>queue.shift().promise,next=>snapshot=next,{initialAccess:admin,initialScope:'/'});
  const first=monitor.refresh('/',{force:true});await settle();
  const current=monitor.refresh('/ninho',{invalidate:true});await settle();
  latest.resolve({userId:'user',role:'operator'});await current;
  old.resolve(admin);await first;
  assert.equal(snapshot.verifiedFor,'/ninho');assert.equal(snapshot.role,'operator');monitor.dispose();
});

test('protected pages can revalidate at 15 seconds and successful revocation removes privileges',async()=>{
  let now=0,loads=0,snapshot;
  const monitor=createSessionAccessMonitor(async()=>{loads++;return {userId:'user',role:'operator'}},next=>snapshot=next,{initialAccess:admin,initialScope:'/ninho',now:()=>now});
  now=14_999;await monitor.refresh('/ninho',{maxAgeMs:15_000});assert.equal(loads,0);
  now++;await monitor.refresh('/ninho',{maxAgeMs:15_000});
  assert.equal(loads,1);assert.equal(snapshot.role,'operator');monitor.dispose();
});

test('logout, mismatched identities and failed checks cannot retain admin privileges',async()=>{
  const late=deferred();let snapshot;
  const monitor=createSessionAccessMonitor(()=>late.promise,next=>snapshot=next,{initialAccess:admin});
  const old=monitor.refresh('/',{force:true});await settle();monitor.observeSession(null);
  late.resolve(admin);await old;
  assert.equal(snapshot.userId,null);assert.equal(snapshot.role,null);monitor.dispose();
  for(const load of [async()=>({userId:'other-admin',role:'admin'}),async()=>({userId:'user',role:'unknown'}),async()=>{throw new Error('offline')}]){
    const current=createSessionAccessMonitor(load,next=>snapshot=next,{initialAccess:admin});
    await current.refresh('/',{force:true});assert.equal(snapshot.role,null);assert.ok(snapshot.error);current.dispose();
  }
});

test('unmount cancels pending checks and cannot update a new login',async()=>{
  const request=deferred();let updates=0,signal;
  const monitor=createSessionAccessMonitor(s=>{signal=s;return request.promise},()=>updates++);
  monitor.observeSession('user');await settle();const before=updates;monitor.dispose();
  assert.equal(signal.aborted,true);request.resolve(admin);await settle();assert.equal(updates,before);
});
