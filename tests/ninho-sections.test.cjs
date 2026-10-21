require('./setup.cjs');
const {test,after}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/ninho'});
global.window=dom.window;global.document=dom.window.document;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true;
require('./dom-setup.cjs')(dom.window);
require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText,filename);
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const originalLoad=Module._load;
Module._load=function(name,...args){if(name==='next/navigation')return{useRouter:()=>({refresh(){},replace(){}})};return originalLoad.call(this,name,...args);};
const {NinhoSettings}=require('../src/components/ninho/ninho-settings.tsx');
Module._load=originalLoad;
const root=createRoot(document.getElementById('app'));
after(async()=>{await act(async()=>root.unmount());dom.window.close();});

test('Ninho conceals sensitive options by default, keeps sections independent and does not reset drafts or expand during refresh',async t=>{
  const calls=[],polls=[];
  t.mock.method(global,'setInterval',fn=>{polls.push(fn);return polls.length;});
  t.mock.method(global,'clearInterval',()=>{});
  t.mock.method(global,'fetch',async(url,options={})=>{
    calls.push({url,method:options.method||'GET'});
    return Response.json(url==='/api/auth/status'?{isConnected:true,status:'valid'}
      :url==='/api/ninho/webhook'?{enabled:true,url:'https://example.test/private-hook',status:{status:'active',lastReceivedAt:'2026-10-21T13:00:00Z'}}
      :url==='/api/nuvemshop/connection'?{connected:false}
      :url==='/api/analytics/connections'?{companies:[],connections:[],jobs:[],sources:[],coverage:[]}
      :url==='/api/analytics/api-usage'?{available:true,accounts:[]}
      :{users:[],currentUserId:'admin'});
  });
  await act(async()=>root.render(React.createElement(NinhoSettings)));
  const sections=['Olist ERP','Nuvemshop','Conexões da Curva ABC','Webhook Olist'];
  const toggle=name=>document.querySelector(`button[aria-label="${name}"]`);
  const panel=name=>document.getElementById(toggle(name).getAttribute('aria-controls'));
  for(const name of sections){assert.equal(toggle(name).getAttribute('aria-expanded'),'false');assert.equal(panel(name).hidden,true);}
  const hook=document.querySelector('input[value="https://example.test/private-hook"]');
  assert.ok(hook.closest('[hidden]'));
  await act(async()=>toggle('Webhook Olist').click());
  assert.equal(hook.closest('[hidden]'),null);
  assert.equal(toggle('Webhook Olist').getAttribute('aria-expanded'),'true');
  for(const name of sections.slice(0,3))assert.equal(panel(name).hidden,true);
  await act(async()=>toggle('Nuvemshop').click());
  const token=[...panel('Nuvemshop').querySelectorAll('input')].find(input=>input.type==='password');
  const setter=Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set;
  await act(async()=>{setter.call(token,'draft-token');token.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
  await act(async()=>toggle('Nuvemshop').click());
  assert.ok(token.closest('[hidden]'));
  await act(async()=>toggle('Nuvemshop').click());
  assert.equal(token.value,'draft-token');
  await act(async()=>document.querySelector('button[aria-label="Atualizar conexões analíticas"]').click());
  assert.equal(panel('Conexões da Curva ABC').hidden,true);
  await act(async()=>{for(const poll of polls)await poll();});
  assert.equal(panel('Olist ERP').hidden,true);assert.equal(panel('Conexões da Curva ABC').hidden,true);
  await act(async()=>toggle('Webhook Olist').click());assert.ok(hook.closest('[hidden]'));
  assert.ok(calls.every(call=>call.method==='GET'),'expanding and collapsing must not mutate integrations');
  assert.equal(document.querySelector('button button,button a'),null,'header actions are independent controls');
  await act(async()=>root.render(null));
});
