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

test('Ninho shows each account webhook and last event, copies only the chosen URL and offers manual copying on failure',async t=>{
  const connections=[1,2,3].map(id=>({id:`connection-${id}`,company_id:`company-${id}`,name:`Olist ${id}`,credential_kind:'oauth',enabled:true,client_id:`app-${id}`,expires_at:'2099-01-01',verified_at:'2026-10-21',last_synced_at:null}));
  const webhooks=connections.map((connection,index)=>({id:connection.id,url:`https://example.test/api/webhooks/olist/owner/account-${index+1}`,lastReceivedAt:index===1?'2026-10-22T13:00:00Z':null}));
  const calls=[],copied=[],polls=[];
  t.mock.method(global,'setInterval',fn=>{polls.push(fn);return polls.length;});
  t.mock.method(global,'clearInterval',()=>{});
  t.mock.method(global,'fetch',async(url,options={})=>{
    calls.push({url,method:options.method||'GET'});
    return Response.json(url==='/api/auth/status'?{isConnected:true,status:'valid'}
      :url==='/api/ninho/webhook'?{enabled:true,url:'https://example.test/legacy-webhook',status:{status:'pending'},connections:webhooks}
      :url==='/api/nuvemshop/connection'?{connected:false}
      :url==='/api/analytics/connections'?{companies:[],connections,jobs:[],sources:[],coverage:[]}
      :url==='/api/analytics/api-usage'?{available:true,accounts:[]}
      :{users:[],currentUserId:'admin'});
  });
  const clipboard={async writeText(value){copied.push(value);}};
  const clipboardDescriptor=Object.getOwnPropertyDescriptor(global.navigator,'clipboard');
  Object.defineProperty(global.navigator,'clipboard',{configurable:true,value:clipboard});
  t.after(()=>{if(clipboardDescriptor)Object.defineProperty(global.navigator,'clipboard',clipboardDescriptor);else delete global.navigator.clipboard;});
  await act(async()=>root.render(React.createElement(NinhoSettings,{key:'per-account-webhooks'})));
  const cards=[...document.querySelectorAll('article[aria-label^="Conexão "]')];
  assert.equal(cards.length,3);
  const fields=cards.map(card=>card.querySelector('input[readonly]'));
  assert.deepEqual(fields.map(field=>field.value),webhooks.map(webhook=>webhook.url));
  assert.equal(new Set(fields.map(field=>field.value)).size,3);
  assert.ok(fields.every(field=>field.closest('[hidden]')),'connection URLs remain inside their collapsed section');
  assert.match(cards[0].textContent,/Aguardando o primeiro evento/);
  assert.match(cards[1].textContent,/Último evento: 22\/10\/2026, 10:00:00 \(Brasília\)/);
  assert.match(cards[2].textContent,/Aguardando o primeiro evento/);
  const toggle=document.querySelector('button[aria-label="Conexões da Curva ABC"]');
  await act(async()=>toggle.click());
  assert.equal(fields[2].closest('[hidden]'),null);
  assert.equal(calls.filter(call=>call.url==='/api/ninho/webhook').length,1,'initial loading must not duplicate webhook reads');
  webhooks[0].lastReceivedAt='2026-10-22T14:00:00Z';
  await act(async()=>document.querySelector('button[aria-label="Atualizar conexões analíticas"]').click());
  assert.match(cards[0].textContent,/Último evento: 22\/10\/2026, 11:00:00/);
  assert.equal(calls.filter(call=>call.url==='/api/ninho/webhook').length,2);
  webhooks[2].lastReceivedAt='2026-10-22T15:00:00Z';
  await act(async()=>{for(const poll of polls)await poll();});
  assert.match(cards[2].textContent,/Último evento: 22\/10\/2026, 12:00:00/);
  assert.equal(calls.filter(call=>call.url==='/api/ninho/webhook').length,3);
  assert.equal(calls.filter(call=>call.url==='/api/auth/status').length,1,'webhook refresh does not reread unrelated authorization');
  await act(async()=>cards[2].querySelector('button[aria-label="Copiar webhook de Olist 3"]').click());
  assert.deepEqual(copied,[webhooks[2].url]);
  assert.match(cards[2].textContent,/URL copiada/);
  assert.doesNotMatch(cards[0].textContent,/URL copiada/);
  t.mock.method(clipboard,'writeText',async()=>{throw new Error('Clipboard unavailable');});
  await act(async()=>cards[0].querySelector('button[aria-label="Copiar webhook de Olist 1"]').click());
  assert.match(document.querySelector('[role="alert"]').textContent,/Selecione a URL do webhook desta conexão e copie manualmente/);
  assert.ok(calls.every(call=>call.method==='GET'),'viewing and copying URLs must not change or synchronize integrations');
  await act(async()=>root.render(null));
});

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

test('users and permissions start collapsed, reveal only the chosen section and preserve edits when collapsed',async t=>{
  const calls=[];
  t.mock.method(global,'setInterval',()=>1);
  t.mock.method(global,'clearInterval',()=>{});
  const members=[{user_id:'admin',display_name:'Pessoa Administradora',email:'private@example.test',role:'admin',active:true}];
  t.mock.method(global,'fetch',async(url,options={})=>{
    calls.push({url,method:options.method||'GET',body:options.body&&JSON.parse(options.body)});
    if(options.method==='PATCH'){members[0].active=JSON.parse(options.body).active;return Response.json({ok:true});}
    return Response.json(url==='/api/auth/status'?{isConnected:true,status:'valid'}
      :url==='/api/ninho/webhook'?{enabled:false,url:null,status:{status:'pending'}}
      :url==='/api/nuvemshop/connection'?{connected:false}
      :url==='/api/analytics/connections'?{companies:[],connections:[],jobs:[],sources:[],coverage:[]}
      :url==='/api/analytics/api-usage'?{available:true,accounts:[]}
      :{users:members,currentUserId:'another-admin'});
  });
  await act(async()=>root.render(React.createElement(NinhoSettings,{key:'users-collapsed'})));
  await act(async()=>document.getElementById('connections-tab').dispatchEvent(new window.KeyboardEvent('keydown',{key:'End',bubbles:true})));
  assert.equal(document.activeElement.id,'users-tab');
  const panel=document.getElementById('ninho-users');
  assert.equal(panel.hidden,false);
  const toggle=name=>panel.querySelector(`button[aria-label="${name}"]`);
  const body=name=>document.getElementById(toggle(name).getAttribute('aria-controls'));
  for(const name of ['Perfis e permissões','Equipe da colmeia','Adicionar à colmeia'])assert.equal(body(name).hidden,true);
  const email=[...panel.querySelectorAll('p')].find(p=>p.textContent==='private@example.test');
  assert.ok(email.closest('[hidden]'));
  assert.ok(panel.querySelector('input[type="password"]').closest('[hidden]'));
  await act(async()=>toggle('Equipe da colmeia').click());
  assert.equal(email.closest('[hidden]'),null);
  assert.equal(body('Perfis e permissões').hidden,true);
  const active=body('Equipe da colmeia').querySelector('input[type="checkbox"]');
  await act(async()=>active.click());
  await act(async()=>toggle('Equipe da colmeia').click());
  assert.ok(email.closest('[hidden]'));
  await act(async()=>toggle('Equipe da colmeia').click());
  assert.equal(active.checked,false);
  assert.equal(calls.filter(c=>c.method!=='GET').length,0);
  await act(async()=>[...body('Equipe da colmeia').querySelectorAll('button')].find(b=>b.textContent==='Salvar').click());
  assert.deepEqual(calls.find(c=>c.method==='PATCH').body,{userId:'admin',role:'admin',active:false});
  await act(async()=>document.getElementById('users-tab').dispatchEvent(new window.KeyboardEvent('keydown',{key:'Home',bubbles:true})));
  assert.equal(panel.hidden,true);
  await act(async()=>document.getElementById('users-tab').click());
  assert.equal(body('Adicionar à colmeia').hidden,true);
  await act(async()=>root.render(null));
});
