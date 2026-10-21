require('./setup.cjs');
const {test,after,afterEach,beforeEach}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),{JSDOM}=require('jsdom');
const dom=new JSDOM('<div id="app"></div>',{url:'http://localhost/ninho'});
global.window=dom.window;global.document=dom.window.document;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true;
require('./dom-setup.cjs')(dom.window);
require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText,filename);
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const {OlistApiMonitor,useOlistApiUsage}=require('../src/components/ninho/olist-api-monitor.tsx');
const {summarizeApiUsage}=require('../src/lib/olist-api-types.ts');
const root=createRoot(document.getElementById('app'));
let tick;
beforeEach(t=>{
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
 t.mock.method(global,'setInterval',(fn,ms)=>{assert.equal(ms,15000);tick=fn;return 42;});
 t.mock.method(global,'clearInterval',()=>{});
});
afterEach(()=>act(async()=>root.render(null)));
after(async()=>{await act(async()=>root.unmount());dom.window.close();});
const row=(source,requests,responses= requests)=>({minute:'2026-10-20T20:17:00Z',source,requests,responses,retries:0,throttled:0,server_errors:0,timeouts:0,network_errors:0,duration_ms:responses*100,max_duration_ms:100});
const account=()=>({connection_id:'c',name:'Olist 1',plan:'Domine',plan_limit:120,app_limit:60,effective_limit:60,monitoring_since:'2026-10-20T20:10:00Z',
 cooldown_until:null,slow_until:null,provider_limit:120,provider_remaining:90,provider_reset_at:'2026-10-20T20:18:45Z',observed_at:'2026-10-20T20:18:20Z',minutes:[row('orders',10),row('costs',2)]});
const data=()=>({available:true,generated_at:'2026-10-20T20:18:30Z',accounts:[account()]});
function Monitor(){return React.createElement(OlistApiMonitor,{connectionId:'c',usage:useOlistApiUsage()});}
const render=()=>act(async()=>root.render(React.createElement(Monitor)));

test('the monitor separates our complete-minute counters from the provider account sample and does not call the provider',async t=>{
 const calls=[];t.mock.method(global,'fetch',async(url,options)=>{calls.push({url,options});return Response.json(data());});
 await render();
 assert.match(document.body.textContent,/App · último minuto12/);
 assert.match(document.body.textContent,/Conta · amostra Olist antiga30\/120/);
 assert.match(document.body.textContent,/10 vendas · 2 CMV/);
 assert.match(document.body.textContent,/permitido 60\/min/);
 assert.equal(document.querySelector('[role="img"]').children.length,15);
 assert.ok(calls.every(c=>c.url==='/api/analytics/api-usage'&&c.options.cache==='no-store'));
 assert.match(document.body.textContent,/Cota compartilhada entre aplicativos/);
});
test('missing provider headers remain unknown and monitoring never invents zero external usage',async t=>{
 const state=data();Object.assign(state.accounts[0],{provider_limit:null,provider_remaining:null,observed_at:null});
 t.mock.method(global,'fetch',async()=>Response.json(state));await render();
 assert.match(document.body.textContent,/Sem amostra/);assert.match(document.body.textContent,/não determinado/);
 assert.doesNotMatch(document.body.textContent,/Conta · amostra Olist0/);
});
test('polling pauses when hidden, refreshes automatically and retains stale readings with an explicit error',async t=>{
 let calls=0,fail=false;const state=data();
 t.mock.method(global,'fetch',async()=>{calls++;return fail?Response.json({error:'Leitura indisponível'},{status:503}):Response.json(state);});
 await render();assert.equal(calls,1);
 Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});await act(async()=>tick());assert.equal(calls,1);
 Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});state.accounts[0].provider_remaining=80;
 await act(async()=>tick());assert.equal(calls,2);assert.match(document.body.textContent,/40\/120/);
 fail=true;await act(async()=>tick());assert.match(document.body.textContent,/Dados desatualizados/);assert.match(document.body.textContent,/40\/120/);
});
test('missing migration has an actionable state while imports retain the old limits',async t=>{
 t.mock.method(global,'fetch',async()=>Response.json({available:false,error:'Aplique a migração v23 para ativar os limites por conta e o monitor de consumo.'}));
 await render();assert.match(document.body.textContent,/Aplique a migração v23/);assert.equal(document.querySelector('[role="img"]'),null);
});
test('current incomplete minutes are excluded from peak and last-minute totals; missing results remain visible',()=>{
 const a=account();a.minutes.push({...row('operational',50,48),minute:'2026-10-20T20:18:00Z'});
 const summary=summarizeApiUsage(a,'2026-10-20T20:18:30Z');
 assert.equal(summary.lastMinute,12);assert.equal(summary.peak,12);assert.equal(summary.averageMs,100);assert.equal(summary.pendingResults,2);
 assert.equal(summary.sources.operational,0);assert.equal(summary.bars[0].covered,false);assert.equal(summary.bars.at(-1).covered,true);
});
