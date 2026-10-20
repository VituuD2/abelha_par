require('./setup.cjs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), ts = require('typescript'), Module = require('node:module');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><div id="app"></div>', {url:'http://localhost:3000/analytics/abc'});
global.window=dom.window; global.document=dom.window.document; global.HTMLElement=dom.window.HTMLElement;
require('./dom-setup.cjs')(dom.window);
global.IS_REACT_ACT_ENVIRONMENT=true;
dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
const React=require('react'), {act}=React, {createRoot}=require('react-dom/client');
const originalLoad=Module._load;
Module._load=function(name,...args){return name==='next/link'?({children,...props})=>React.createElement('a',props,children):originalLoad.call(this,name,...args);};
const { ABCDashboard }=require('../src/components/analytics/abc-dashboard.tsx');
Module._load=originalLoad;
const {paretoAtPercentage}=require('../src/lib/analytics/pareto.ts');
const root=createRoot(document.getElementById('app')), originalFetch=global.fetch;
let requests=[];
let accumulated=0;
const rows=[18,20,30,15,10,7].map((percent,index)=>{const before=accumulated;accumulated+=percent;return{entityId:'conn:'+index,name:'Produto '+index,sku:'SKU-'+index,revenue:String(percent*100),quantity:'2',orders:2,rank:index+1,class:index<3?'A':'B',percent,cumulativeBefore:before,cumulative:accumulated};});
const status={companies:[],connections:[],jobs:[],options:{}};
before(async()=>{
 global.fetch=async(url,options={})=>{
  const body=options.body?JSON.parse(options.body):undefined;requests.push({url,body});
  const result={rows,total:6,revenue:'10000',quantity:'12',orders:6,classes:{},top10:100,pareto:rows,generatedAt:'2026-10-19T00:00:00Z'};
  return Response.json(url.includes('options')||url.endsWith('/sync')?status:url.includes('drilldown')?{orders:[],companies:[],channels:[],total:0}:result);
 };
 await act(async()=>root.render(React.createElement(ABCDashboard,{isAdmin:false})));
});
after(async()=>{await act(async()=>root.unmount());global.fetch=originalFetch;dom.window.close();});
const fire=async(element,type,init={})=>act(async()=>{
 const event=type.startsWith('key')?new dom.window.KeyboardEvent(type,{bubbles:true,...init}):new dom.window.MouseEvent(type,{bubbles:true,...init});
 if(init.pointerType)Object.defineProperty(event,'pointerType',{value:init.pointerType});
 element.dispatchEvent(event);
});
const highlighted=()=>[...document.querySelectorAll('tbody tr[data-highlighted="true"]')];
const chart=()=>document.querySelector('svg[role="img"]');
const tooltip=()=>document.querySelector('[data-pareto-tooltip]');

test('bar hover immediately links a custom tooltip, curve marker and table without API calls',async()=>{
 const before=requests.length;
 await fire(document.querySelector('[data-pareto-bar="conn:0"]'),'pointerover');
 assert.match(tooltip().textContent,/Produto 0/);
 assert.match(tooltip().textContent,/18%/);
 assert.equal(chart().querySelectorAll('title').length,0);
 assert.deepEqual(highlighted().map(row=>row.dataset.abcEntity),['conn:0']);
 assert.equal(requests.length,before);
});

test('curve hover and percentage controls highlight the whole prefix, including the crossing product',async()=>{
 await fire(document.querySelector('[data-pareto-point="conn:2"]'),'pointerover');
 assert.equal(highlighted().length,3);
 assert.match(tooltip().textContent,/68%/);
 assert.equal(document.querySelectorAll('[data-pareto-bar][data-highlighted="true"]').length,3);
 await fire(document.querySelector('button[aria-label="Destacar produtos até 20% do acumulado"]'),'pointerover');
 assert.equal(highlighted().length,2);
 assert.match(tooltip().textContent,/38%/);
 assert.match(tooltip().textContent,/Percentual explorado: 20%/);
 await fire(document.querySelector('button[aria-label="Destacar produtos até 30% do acumulado"]'),'pointerover');
 assert.match(tooltip().textContent,/Percentual explorado: 30%/);
 assert.equal(paretoAtPercentage(rows,18).entityId,'conn:0');
 assert.equal(paretoAtPercentage(rows.slice(0,2),95).entityId,'conn:1');
});

test('hovering a table product reverses the link to its bar and curve point',async()=>{
 await fire(document.querySelector('tr[data-abc-entity="conn:4"]'),'pointerover');
 assert.match(tooltip().textContent,/Produto 4/);
 assert.deepEqual(highlighted().map(row=>row.dataset.abcEntity),['conn:4']);
 assert.equal(document.querySelector('[data-pareto-bar="conn:4"]').dataset.highlighted,'true');
});

test('the whole product row opens orders once, including name clicks and keyboard activation',async()=>{
 const row=document.querySelector('tr[data-abc-entity="conn:4"]');
 assert.ok(row.classList.contains('cursor-pointer'));assert.equal(row.tabIndex,0);
 let count=requests.filter(request=>request.url.includes('drilldown')).length;
 for(const target of [row.querySelector('td:last-child'),row.querySelector('button')]){
  await fire(target,'click');
  assert.equal(requests.filter(request=>request.url.includes('drilldown')).length,++count);
  assert.equal(requests.filter(request=>request.url.includes('drilldown')).at(-1).body.entity,'conn:4');
  await act(async()=>document.querySelector('dialog').close());
 }
 for(const key of ['Enter',' ']){
  await fire(row,'keydown',{key});
  assert.equal(document.querySelector('dialog').open,true);
  assert.equal(requests.filter(request=>request.url.includes('drilldown')).length,++count);
  await act(async()=>document.querySelector('dialog').close());
 }
});

test('keyboard navigation supports cumulative exploration, dismissal and order drilldown',async()=>{
 await fire(chart(),'keydown',{key:'Home'});
 await fire(chart(),'keydown',{key:'ArrowRight',shiftKey:true});
 assert.equal(highlighted().length,2);
 await fire(chart(),'keydown',{key:'Escape'});
 assert.equal(tooltip(),null);
 assert.equal(highlighted().length,0);
 await fire(chart(),'keydown',{key:'Home'});
 await fire(chart(),'keydown',{key:'Enter'});
 assert.equal(document.querySelector('dialog').open,true);
 assert.equal(requests.filter(r=>r.url.includes('drilldown')).at(-1).body.entity,'conn:0');
});

test('the full plot responds to pointer position and a touch selection survives pointer exit',async()=>{
 const svg=chart();svg.getBoundingClientRect=()=>({left:0,top:0,width:860,height:270,right:860,bottom:270});
 await fire(svg,'pointermove',{clientX:48+780*2.5/6,clientY:100});
 assert.equal(highlighted().length,3);
 await fire(svg,'pointermove',{clientX:48+780*1.5/6,clientY:225});
 assert.equal(highlighted().length,1);
 assert.match(tooltip().textContent,/Produto 1/);
 await fire(svg,'pointerdown',{clientX:48+780*3.5/6,clientY:100,pointerType:'touch'});
 await fire(svg,'pointerout',{pointerType:'touch'});
 assert.ok(tooltip());
 assert.equal(highlighted().length,4);
});

test('base product mode is explicitly sent to the server and remains separate from raw ERP products',async()=>{
 const tab=[...document.querySelectorAll('[role="tab"]')].find(el=>el.textContent==='Produtos base');
 await act(async()=>tab.click());
 assert.equal(requests.filter(r=>r.url.endsWith('/abc')).at(-1).body.filters.grouping,'composition');
 assert.equal(tab.getAttribute('aria-selected'),'true');
});

test('all products remain interactive beyond rank 60 and the chart width follows the available count',async()=>{
 const {ParetoChart}=require('../src/components/analytics/pareto-chart.tsx');
 const opened=[];
 function Preview({count}){
  const [highlight,onHighlight]=React.useState(null);
  const all=Array.from({length:count},(_,i)=>({...rows[0],entityId:'full:'+i,name:'Produto completo '+i,rank:i+1,percent:100/count,cumulativeBefore:i*100/count,cumulative:(i+1)*100/count}));
  return React.createElement(ParetoChart,{result:{rows:all.slice(0,25),pareto:all,total:count,top10:10},a:80,b:95,highlight,onHighlight,onOpen:row=>opened.push(row.entityId)});
 }
 await act(async()=>root.render(React.createElement(Preview,{count:82})));
 assert.equal(document.querySelectorAll('[data-pareto-bar]').length,82);assert.equal(document.querySelectorAll('[data-pareto-point]').length,82);
 const smaller=Number(chart().getAttribute('viewBox').split(' ')[2]);
 assert.doesNotMatch(document.body.textContent,/Passe o mouse|Referências A|Exibindo os primeiros|Explore um produto/);
 await fire(chart(),'keydown',{key:'End'});assert.match(tooltip().textContent,/Produto completo 81/);
 await fire(chart(),'keydown',{key:'Enter'});assert.equal(opened.at(-1),'full:81');
 await act(async()=>root.render(React.createElement(Preview,{count:164})));
 assert.equal(document.querySelectorAll('[data-pareto-bar]').length,164);assert.ok(Number(chart().getAttribute('viewBox').split(' ')[2])>smaller);
 const before=requests.length;
 await fire(document.querySelector('[data-pareto-bar="full:163"]'),'pointerover');
 assert.match(tooltip().textContent,/Produto completo 163/);assert.equal(requests.length,before);
});
