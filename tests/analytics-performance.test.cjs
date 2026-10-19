require('./setup.cjs');
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'http://localhost/analytics/abc'});
global.window=dom.window;global.document=dom.window.document;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true;
Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText,filename);
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const original=Module._load;
Module._load=function(name,...args){if(name==='next/link')return({children,...props})=>React.createElement('a',props,children);return original.call(this,name,...args)};
const {ABCDashboard}=require('../src/components/analytics/abc-dashboard.tsx');Module._load=original;
const root=createRoot(document.getElementById('app'));
after(async()=>{await act(async()=>root.unmount());dom.window.close()});
const row={entityId:'composition:BASE',name:'Produto consolidado',sku:'BASE',rank:1,revenue:'12345',quantity:'3',orders:2,percent:100,cumulativeBefore:0,cumulative:100,class:'A'};
const result={rows:[row],total:1,revenue:'12345',quantity:'3',orders:2,classes:{A:{count:1,revenue:'12345',quantity:'3',percent:100}},top10:100,pareto:[row],generatedAt:'2026-10-19T00:00:00Z'};
const status=()=>({companies:[],connections:[],sources:[],coverage:[],jobs:[],options:{}});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const render=key=>act(async()=>root.render(React.createElement(ABCDashboard,{key,isAdmin:false,initialGrouping:'composition'})));

test('report and filters render without waiting for coverage scheduling; paging does not schedule again',async t=>{
  const schedule=deferred(),calls=[];
  t.mock.method(global,'fetch',async(url,options={})=>{
    const body=options.body&&JSON.parse(options.body);calls.push({url,body});
    if(url.endsWith('/coverage'))return schedule.promise;
    if(url.endsWith('/abc')){assert.equal(body.ensureCoverage,false);return Response.json(result)}
    return Response.json(status());
  });
  await render('independent');
  assert.match(document.querySelector('tbody').textContent,/Produto consolidado/);
  assert.equal(calls.filter(c=>c.url.endsWith('/coverage')).length,1);
  assert.equal(calls.filter(c=>c.url.endsWith('/sync')).length,0);
  await act(async()=>schedule.resolve(Response.json({sync:{scheduled:1}})));
  assert.equal(calls.filter(c=>c.url.endsWith('/sync')).length,1);
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Valor bruto').click());
  assert.equal(calls.filter(c=>c.url.endsWith('/abc')).at(-1).body.sort,'revenue');
  assert.equal(calls.filter(c=>c.url.endsWith('/coverage')).length,1);
});

test('scheduling failure stays actionable without losing report values and manual refresh retries it',async t=>{
  let scheduling=0;
  t.mock.method(global,'fetch',async url=>{
    if(url.endsWith('/coverage'))return ++scheduling===1?Response.json({error:'Agendamento temporariamente indisponível'},{status:503}):Response.json({sync:{scheduled:1}});
    return Response.json(url.endsWith('/abc')?result:status());
  });
  await render('schedule-error');
  assert.match(document.querySelector('[role="alert"]').textContent,/Agendamento temporariamente/);
  assert.match(document.querySelector('tbody').textContent,/Produto consolidado/);
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Atualizar').click());
  assert.equal(scheduling,2);assert.equal(document.querySelector('[role="alert"]'),null);
  assert.match(document.querySelector('tbody').textContent,/Produto consolidado/);
});

test('a late scheduling failure from previous filters cannot overwrite the current analysis',async t=>{
  const old=deferred();let scheduling=0,oldSignal;
  t.mock.method(global,'fetch',async(url,options={})=>{
    if(url.endsWith('/coverage')){
      if(++scheduling===1){oldSignal=options.signal;return old.promise}
      return Response.json({sync:{scheduled:0}});
    }
    return Response.json(url.endsWith('/abc')?result:status());
  });
  await render('old-scheduling');
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Clientes').click());
  assert.equal(oldSignal.aborted,true);assert.equal(scheduling,2);
  await act(async()=>old.reject(new Error('Falha do filtro anterior')));
  assert.equal(document.querySelector('[role="alert"]'),null);
  assert.match(document.querySelector('tbody').textContent,/Produto consolidado/);
});

test('import progress never aborts a slow initial report and coalesces several updates into one follow-up read',async t=>{
  let tick,now=0,reports=0,schedules=0,firstSignal;
  t.mock.method(Date,'now',()=>now);
  t.mock.method(global,'setInterval',(fn,ms)=>{assert.equal(ms,15000);tick=fn;return 1});
  t.mock.method(global,'clearInterval',()=>{});
  const first=deferred(),current=status();
  current.jobs=[{id:'job',connection_id:'c',mode:'backfill',status:'running',from_date:'2026-09-01',to_date:'2026-10-19',cursor_date:'2026-09-01',processed:0}];
  t.mock.method(global,'fetch',async(url,options={})=>{
    if(url.endsWith('/abc')){
      assert.equal(JSON.parse(options.body).ensureCoverage,false);
      if(++reports===1){firstSignal=options.signal;return first.promise}
      return Response.json({...result,rows:[{...row,name:'Resultado atualizado'}]});
    }
    if(url.endsWith('/coverage')){schedules++;return Response.json({sync:{scheduled:0}})}
    return Response.json(current);
  });
  await render('slow-report');assert.equal(reports,1);assert.equal(typeof tick,'function');
  for(let i=1;i<=3;i++){
    now+=15_000;current.jobs[0].processed=i;
    await act(async()=>tick());
    assert.equal(reports,1);assert.equal(firstSignal.aborted,false);
  }
  await act(async()=>first.resolve(Response.json(result)));
  assert.equal(reports,2,'one follow-up for all three changes');assert.equal(schedules,1);
  assert.match(document.querySelector('tbody').textContent,/Resultado atualizado/);
  Object.defineProperty(document,'visibilityState',{value:'hidden',configurable:true});
  now+=15000;current.jobs[0].processed=4;await act(async()=>tick());assert.equal(reports,2);
  Object.defineProperty(document,'visibilityState',{value:'visible',configurable:true});
});
