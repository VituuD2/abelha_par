require('./setup.cjs');
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),Module=require('node:module'),ts=require('typescript');
const {JSDOM}=require('jsdom');
const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'http://localhost/analytics/abc'});
global.window=dom.window;global.document=dom.window.document;global.HTMLElement=dom.window.HTMLElement;global.IS_REACT_ACT_ENVIRONMENT=true;
require('./dom-setup.cjs')(dom.window);
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
const render=(key,isAdmin=false)=>act(async()=>root.render(React.createElement(ABCDashboard,{key,isAdmin,initialGrouping:'composition'})));

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

test('cost progress recovers an open component report with no pending sales jobs and never starts a browser worker',async t=>{
  let tick,reports=0;const current=status(),calls=[];
  current.costSync={connection_id:'olist1',updated_at:'2026-10-20T12:00:00Z',last_synced_at:null};
  t.mock.method(global,'setInterval',(fn,ms)=>{assert.equal(ms,15000);tick=fn;return 1});
  t.mock.method(global,'clearInterval',()=>{});
  t.mock.method(global,'fetch',async(url,options={})=>{
    calls.push({url,options});
    if(url.endsWith('/abc')){reports++;return current.costSync.last_synced_at?Response.json(result):Response.json({error:'CMV pendente da Olist 1'},{status:400});}
    return Response.json(url.endsWith('/coverage')?{sync:{scheduled:0}}:current);
  });
  await render('cost-progress');assert.equal(reports,1);assert.equal(typeof tick,'function');
  assert.match(document.querySelector('[role="alert"]').textContent,/CMV pendente/);
  await act(async()=>tick());assert.equal(reports,1,'identical cache progress does not rerun report math');
  current.costSync.last_synced_at='2026-10-20T12:01:00Z';current.costSync.updated_at=current.costSync.last_synced_at;
  await act(async()=>tick());assert.equal(reports,2);assert.equal(document.querySelector('[role="alert"]'),null);
  assert.match(document.querySelector('tbody').textContent,/Produto consolidado/);
  assert.equal(calls.some(c=>c.url.includes('/sync')&&c.options.method==='POST'),false);
  assert.equal(calls.some(c=>c.url.includes('tiny.com.br')),false);
});

test('Ninho exposes cost freshness and errors, and manual refresh only schedules the server job',async t=>{
  const {AnalyticsConnections}=require('../src/components/ninho/analytics-connections.tsx');
  const current={...status(),costSync:{connection_id:'olist1',history:{total:2,completed:2,pending:0,last_synced_at:'2026-10-20T12:00:00Z'},last_synced_at:'2026-10-20T12:00:00Z',next_at:'2099-01-01T00:00:00Z',last_error:'Libere a leitura de Produtos na Olist 1'}};
  const calls=[];
  t.mock.method(global,'fetch',async(url,options={})=>{calls.push({url,options});return Response.json(options.method==='POST'?{scheduled:true}:current);});
  await act(async()=>root.render(React.createElement(AnalyticsConnections,{key:'cost-ninho'})));
  assert.match(document.body.textContent,/CMV da Olist 1/);assert.match(document.body.textContent,/Libere a leitura de Produtos/);
  assert.match(document.body.textContent,/20\/10\/2026/);
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Programar atualização do CMV').click());
  const posted=calls.filter(c=>c.options.method==='POST');assert.equal(posted.length,1);
  assert.equal(posted[0].url,'/api/analytics/connections');assert.deepEqual(JSON.parse(posted[0].options.body),{action:'refresh-costs'});
});

test('component analysis exposes historical total cost and applies an explicit purchase versus average basis',async t=>{
  const calls=[];
  t.mock.method(global,'fetch',async(url,options={})=>{
    const body=options.body&&JSON.parse(options.body);calls.push({url,body});
    if(url.endsWith('/abc'))return Response.json({...result,composition:{version:'v19',revenuePolicy:'cost',
      costSource:{kind:'olist',policy:'effective_date',basis:body.filters.costBasis,name:'Olist 1'},
      periodCostCents:'110000',knownCostCents:'110000',costMissingLines:0,mappedEntities:1,pending:[],pendingTotal:0,
      originalRevenue:result.revenue,unallocatedLines:0,missingCostSkus:[],
    }});
    return Response.json(url.endsWith('/coverage')?{sync:{scheduled:0}}:status());
  });
  await render('historical-cost-basis',true);assert.match(document.body.textContent,/1\.100,00/);
  assert.match(document.body.textContent,/Custos posteriores/);
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Mais filtros').click());
  const control=[...document.querySelectorAll('select')].find(select=>select.querySelector('option[value="purchase"]'));
  assert.equal(control.value,'purchase');
  assert.equal(calls.filter(c=>c.url.endsWith('/abc')).at(-1).body.filters.costBasis,'purchase');
  await act(async()=>{control.value='average';control.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
  await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Analisar vendas').click());
  assert.equal(calls.filter(c=>c.url.endsWith('/abc')).at(-1).body.filters.costBasis,'average');
  assert.match(document.body.textContent,/Custo médio vigente/);
});

test('Ninho lets an administrator resume a retry checkpoint without creating a new historical range',async t=>{
 const {AnalyticsConnections}=require('../src/components/ninho/analytics-connections.tsx'),calls=[];
 const current={...status(),jobs:[{id:'blocked',connection_id:'olist2',mode:'backfill',status:'retry',from_date:'2026-08-01',to_date:'2026-10-02',cursor_date:'2026-08-10',pages:10,processed:522,last_error:'Valor decimal inválido ou negativo.',error_code:null}]};
 t.mock.method(global,'setInterval',()=>1);t.mock.method(global,'clearInterval',()=>{});
 t.mock.method(global,'fetch',async(url,options={})=>{calls.push({url,options});return Response.json(options.method==='POST'?{queued:true}:current);});
 await act(async()=>root.render(React.createElement(AnalyticsConnections,{key:'signed-price-retry'})));
 assert.match(document.body.textContent,/522 pedidos processados/);
 await act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Retomar este checkpoint').click());
 const requests=calls.filter(c=>c.options.method==='POST');assert.equal(requests.length,1);
 assert.equal(requests[0].url,'/api/analytics/sync');assert.deepEqual(JSON.parse(requests[0].options.body),{action:'retry',job:'blocked'});
});

test('zero and negative CMV totals render normally with the disclosed allocation policy',async t=>{
 let cost='0.0000';
 t.mock.method(global,'fetch',async(url)=>{
  if(url.endsWith('/abc'))return Response.json({...result,composition:{version:'v21',revenuePolicy:'cost',
   costSource:{kind:'olist',policy:'effective_date',basis:'purchase',name:'Olist 1',allocationPolicy:'signed_cost_magnitude_zero_quantity'},
   periodCostCents:cost,knownCostCents:cost,costMissingLines:0,zeroCostLines:1,negativeCostLines:cost.startsWith('-')?1:0,quantityAllocationLines:1,
   pending:[],pendingTotal:0,mappedEntities:1,originalRevenue:result.revenue,unallocatedLines:0,missingCostSkus:[],
  }});
  return Response.json(url.endsWith('/coverage')?{sync:{scheduled:0}}:status());
 });
 await render('zero-cost-accepted',true);assert.equal(document.querySelector('[role="alert"]'),null);
 assert.match(document.body.textContent,/custo informado zero/);assert.match(document.body.textContent,/todos os custos zerados foram rateados/);
 assert.match(document.body.textContent,/magnitude dos custos/);assert.match(document.body.textContent,/R\$\s*0,00/);
 cost='-100.0000';await render('negative-cost-accepted',true);assert.equal(document.querySelector('[role="alert"]'),null);
 assert.match(document.body.textContent,/custo negativo, preservado no CMV/);assert.match(document.body.textContent,/−R\$\s*1,00/);
});

test('missing cost data is not presented as a connection fault',async t=>{
 t.mock.method(global,'fetch',async(url)=>url.endsWith('/abc')
  ? Response.json({code:'HISTORICAL_COST_UNAVAILABLE',error:'Falta um valor informado com vigência.'},{status:422})
  : Response.json(url.endsWith('/coverage')?{sync:{scheduled:0}}:status()));
 await act(async()=>root.render(React.createElement(ABCDashboard,{key:'cost-data-error',isAdmin:true,initialGrouping:'composition'})));
 assert.match(document.querySelector('[role="alert"]').textContent,/Falta um valor informado/);
 assert.doesNotMatch(document.querySelector('[role="alert"]').textContent,/Verificar conexões/);
});

test('filters start compact, preserve choices when collapsed and keep additional rules closed until requested',async t=>{
 const calls=[];
 t.mock.method(global,'fetch',async(url,options={})=>{
  calls.push({url,body:options.body&&JSON.parse(options.body)});
  return Response.json(url.endsWith('/abc')?result:url.endsWith('/coverage')?{sync:{scheduled:0}}:status());
 });
 await render('compact-filters');
 const form=()=>document.querySelector('form');
 const button=text=>[...form().querySelectorAll('button')].find(b=>b.textContent.trim()===text);
 assert.deepEqual([...form().querySelectorAll('.app-control-label')].map(l=>l.textContent.trim()),['De','Até']);
 assert.deepEqual([...form().querySelectorAll('button:not(.app-calendar-trigger)')].map(b=>b.textContent.trim()),['Últimos 7 dias','Últimos 30 dias','Últimos 90 dias','Analisar vendas','Mais filtros']);
 const initialReports=calls.filter(c=>c.url.endsWith('/abc')).length;
 await act(async()=>button('Últimos 7 dias').click());
 const dates=[...form().querySelectorAll('.app-date-picker input')].map(input=>input.value);
 assert.equal((Date.parse(dates[1])-Date.parse(dates[0]))/86400000,6);
 assert.equal(calls.filter(c=>c.url.endsWith('/abc')).length,initialReports);
 await act(async()=>button('Mais filtros').click());
 assert.equal(button('Recolher filtros').getAttribute('aria-expanded'),'true');
 assert.equal(button('Filtros e regras adicionais').getAttribute('aria-expanded'),'false');
 assert.equal(form().querySelector('option[value="STRICT_CUMULATIVE"]'),null);
 const select=form().querySelector('option[value="quantity"]').parentElement;
 await act(async()=>{select.value='quantity';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));});
 await act(async()=>button('Filtros e regras adicionais').click());
 assert.ok(form().querySelector('option[value="STRICT_CUMULATIVE"]'));
 await act(async()=>button('Recolher filtros').click());
 assert.equal(form().querySelector('select'),null);
 await act(async()=>button('Mais filtros').click());
 assert.equal(form().querySelector('option[value="quantity"]').parentElement.value,'quantity');
 assert.equal(button('Filtros e regras adicionais').getAttribute('aria-expanded'),'false');
 await act(async()=>button('Analisar vendas').click());
 const applied=calls.filter(c=>c.url.endsWith('/abc')).at(-1).body.filters;
 assert.equal(applied.metric,'quantity');assert.equal(applied.from,dates[0]);assert.equal(applied.to,dates[1]);
});

test('only administrators see consolidation rules while operators retain the chart and table',async t=>{
 const composition={version:'v21',revenuePolicy:'cost',costSource:{kind:'olist',name:'Olist 1'},mappedEntities:1,pending:[],pendingTotal:0,unallocatedLines:0,missingCostSkus:[]};
 t.mock.method(global,'fetch',async(url)=>Response.json(url.endsWith('/abc')?{...result,composition}:url.endsWith('/coverage')?{sync:{scheduled:0}}:status()));
 await render('operator-consolidation');assert.equal(document.querySelector('[aria-label="Regras da consolidação"]'),null);
 assert.ok(document.querySelector('[data-pareto-bar]'));assert.match(document.querySelector('tbody').textContent,/Produto consolidado/);
 await render('admin-consolidation',true);assert.ok(document.querySelector('[aria-label="Regras da consolidação"]'));
});
