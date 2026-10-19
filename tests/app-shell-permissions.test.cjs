require('./setup.cjs');
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="app"></div>',{url:'https://app.test/'});
global.window=dom.window;global.document=dom.window.document;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true;
let visibility='visible';
Object.defineProperty(document,'visibilityState',{get:()=>visibility});
require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
let pathname='/',observer,serverRole='admin',reply=null;
const redirects=[],bindings=[];
const router={replace:path=>redirects.push(path),refresh:()=>{}};
const store={persist:{async rehydrate(){}},getState:()=>({bindOwner:id=>bindings.push(id)})};
const original=Module._load;
Module._load=function(name,...args){
  if(name==='next/navigation')return {usePathname:()=>pathname,useRouter:()=>router};
  if(name==='next/link')return ({children,...props})=>React.createElement('a',props,children);
  if(name==='framer-motion')return {motion:{div:({children,layoutId,transition,...props})=>React.createElement('div',props,children)}};
  if(name==='@/stores/preparation-store')return {usePreparationStore:store};
  if(name==='@/stores/scan-store')return {useScanStore:store};
  if(name==='@/lib/supabase/client')return {createClient:()=>({auth:{onAuthStateChange(cb){observer=cb;return {data:{subscription:{unsubscribe(){}}}};}}})};
  return original.call(this,name,...args);
};
const {AppShell}=require('../src/components/layout/app-shell.tsx');Module._load=original;
const root=createRoot(document.getElementById('app'));
after(async()=>{await act(async()=>root.unmount());dom.window.close();});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const render=async(children='OPERATION',props={})=>act(async()=>root.render(React.createElement(AppShell,{userId:'same-user',...props},children)));

test('cached admin layout cannot mount Ninho for a demoted operator; live revocation removes mounted settings while scanning state stays bound',async t=>{
  let now=0;t.mock.method(Date,'now',()=>now);
  const timers=new Map();let nextTimer=0,mounts=0;
  t.mock.method(global,'setInterval',(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;});
  t.mock.method(global,'clearInterval',id=>timers.delete(id));
  t.mock.method(global,'fetch',async()=>reply?reply.promise:Response.json({userId:'same-user',role:serverRole}));
  function Secret(){React.useEffect(()=>{mounts++;},[]);return React.createElement('section',null,'NINHO PRIVATE SETTINGS');}
  await render();
  await act(async()=>observer('SIGNED_IN',{user:{id:'same-user'}}));
  assert.equal(document.querySelectorAll('a[href="/ninho"]').length,2);
  const before=bindings.length;
  reply=deferred();pathname='/ninho';
  await render(React.createElement(Secret));
  assert.equal(mounts,0);assert.doesNotMatch(document.body.textContent,/PRIVATE SETTINGS/);
  await act(async()=>reply.resolve(Response.json({userId:'same-user',role:'operator'})));
  reply=null;
  assert.equal(mounts,0);assert.ok(redirects.includes('/'));
  pathname='/';serverRole='admin';await render();
  pathname='/ninho';await render(React.createElement(Secret));
  assert.match(document.body.textContent,/PRIVATE SETTINGS/);assert.equal(mounts,1);
  // Leave and return to the same URL before the cache expires. The old proof
  // must not mount privileged content while a fresh check is still pending.
  pathname='/orders';await render();
  pathname='/ninho';reply=deferred();await render(React.createElement(Secret));
  assert.equal(mounts,1);assert.doesNotMatch(document.body.textContent,/PRIVATE SETTINGS/);
  await act(async()=>reply.resolve(Response.json({userId:'same-user',role:'operator'})));reply=null;
  assert.equal(mounts,1);
  pathname='/';await render();
  pathname='/ninho';await render(React.createElement(Secret));assert.equal(mounts,2);
  serverRole='operator';
  now+=15_000;
  await act(async()=>{[...timers.values()].find(x=>x.ms===15000).fn();});
  assert.doesNotMatch(document.body.textContent,/PRIVATE SETTINGS/);
  assert.equal(document.querySelectorAll('a[href="/ninho"]').length,0);
  assert.equal(bindings.length,before,'role revalidation must not reset scanner/preparation ownership');
});

test('server-verified startup skips access fetch and Alt+Tab deduplicates background checks without remounting the app or blinking Ninho',async t=>{
  pathname='/';visibility='visible';let now=0,calls=0,mounts=0;reply=null;
  t.mock.method(Date,'now',()=>now);
  const timers=new Map();let id=0;
  t.mock.method(global,'setInterval',(fn,ms)=>{timers.set(++id,{fn,ms});return id;});
  t.mock.method(global,'clearInterval',key=>timers.delete(key));
  t.mock.method(global,'fetch',async()=>{calls++;return reply?reply.promise:Response.json({userId:'same-user',role:'admin'});});
  function Operation(){React.useEffect(()=>{mounts++},[]);return React.createElement('section',null,'SCANNING CONTINUES');}
  await render(React.createElement(Operation),{key:'bootstrap',initialAccess:{userId:'same-user',role:'admin'}});
  await act(async()=>observer('INITIAL_SESSION',{user:{id:'same-user'}}));
  assert.equal(calls,0);assert.equal(mounts,1);
  const ninho=document.querySelector('a[href="/ninho"]');assert.ok(ninho);
  const switchBack=async()=>act(async()=>{
    window.dispatchEvent(new dom.window.Event('focus'));
    window.dispatchEvent(new dom.window.Event('pageshow'));
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    observer('SIGNED_IN',{user:{id:'same-user'}});
  });
  for(let i=0;i<10;i++)await switchBack();
  assert.equal(calls,0);assert.equal(document.querySelector('a[href="/ninho"]'),ninho);
  now=60_000;reply=deferred();
  await switchBack();await switchBack();
  assert.equal(calls,1);assert.equal(mounts,1);
  assert.match(document.body.textContent,/SCANNING CONTINUES/);
  assert.equal(document.querySelector('a[href="/ninho"]'),ninho);
  await act(async()=>reply.resolve(Response.json({userId:'same-user',role:'admin'})));reply=null;
  assert.equal(document.querySelector('a[href="/ninho"]'),ninho);assert.equal(mounts,1);
  now=120_000;visibility='hidden';
  await act(async()=>{
    window.dispatchEvent(new dom.window.Event('focus'));
    document.dispatchEvent(new dom.window.Event('visibilitychange'));
    [...timers.values()][0].fn();
  });
  assert.equal(calls,1,'hidden tabs do not poll');
  visibility='visible';await switchBack();assert.equal(calls,2);
  assert.equal(mounts,1);
  await act(async()=>observer('SIGNED_OUT',null));
  assert.equal(document.querySelector('a[href="/ninho"]'),null);
  assert.doesNotMatch(document.body.textContent,/SCANNING CONTINUES/);
});
