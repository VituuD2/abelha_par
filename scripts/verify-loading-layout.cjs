/* Real browser regression check with synthetic data; no production server/auth.
 * Uses Next's installed compiler and a disposable, isolated headless Chrome.
 * Run: node scripts/verify-loading-layout.cjs (override CHROME_PATH if needed). */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const nextWebpack = require('next/dist/compiled/webpack/webpack');
nextWebpack.init();
const webpack = nextWebpack.webpack;

async function launchBrowser(executable, tmp) {
  const child=spawn(executable,['--headless','--no-first-run','--no-default-browser-check','--disable-gpu','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${path.join(tmp,'browser-profile')}`],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  const address=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Browser startup timed out')),15000);let stderr='';
    child.stderr.on('data',chunk=>{stderr+=chunk;const match=stderr.match(/DevTools listening on (ws:\/\/\S+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('Browser exited during startup'));});
  });
  const socket=new WebSocket(address);await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  const waiting=new Map();let sequence=0;let bindingHandler=()=>{};
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.bindingCalled')bindingHandler(message);if(!message.id)return;const pending=waiting.get(message.id);if(!pending)return;waiting.delete(message.id);clearTimeout(pending.timer);message.error?pending.reject(Error(JSON.stringify(message.error))):pending.resolve(message.result);});
  const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{waiting.delete(id);reject(Error(method+' timed out'));},30000);waiting.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
  return {send,onBinding(handler){bindingHandler=handler;},async close(){await send('Browser.close').catch(()=>{});socket.close();child.kill();}};
}

const fixture = String.raw`
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ABCDashboard } from '@/components/analytics/abc-dashboard';
const all = Array.from({length:200},(_,i)=>({entityId:'p'+i,name:'Produto de teste '+i,sku:'SKU-'+i,revenue:'10000',quantity:'12',orders:2,rank:i+1,class:i<160?'A':i<190?'B':'C',percent:0.5,cumulativeBefore:i/2,cumulative:(i+1)/2}));
const report = (count=200) => ({rows:all.slice(0,Math.min(25,count)),pareto:all.slice(0,count),total:count,revenue:String(count*10000),quantity:String(count*12),orders:count*2,top10:5,generatedAt:'2026-10-22T13:00:00Z',classes:{A:{count:160,revenue:'1600000',quantity:'1920',percent:80},B:{count:30,revenue:'300000',quantity:'360',percent:15},C:{count:10,revenue:'100000',quantity:'120',percent:5}}});
const status = {companies:[{id:'co',name:'Empresa de teste'}],connections:[{id:'c',company_id:'co',name:'Conta de teste',enabled:true,verified_at:'2026-01-01'}],sources:[],coverage:[{connection_id:'c',mode:'backfill',status:'completed',from_date:'2020-01-01',to_date:'2100-01-01'}],jobs:[],options:{}};
const comparison = {period:{from:'2026-09-01',to:'2026-09-30'},previous:{revenue:'1000000',quantity:'1000',orders:200,total:100,top10:10}};
let pending=false; const releases={};
window.fetch = async (url,init={}) => {
  const type=url.endsWith('/abc')?'report':url.endsWith('/comparison')?'comparison':null;
  const body=init.body?JSON.parse(init.body):{};
  if(pending && type) return new Promise(resolve=>{releases[type]=(value,status=200)=>resolve(Response.json(value,{status}));});
  const ordered=body.sort && body.sort!=='rank'?[...all].reverse():all;
  return Response.json(type==='report'?{...report(),rows:ordered.slice(((body.page||1)-1)*(body.size||25),(body.page||1)*(body.size||25))}:type==='comparison'?comparison:url.endsWith('/coverage')?{sync:{scheduled:0}}:status);
};
const pause = ()=>new Promise(resolve=>setTimeout(resolve,60));
const press = element=>new Promise(resolve=>{const rect=element.getBoundingClientRect();window.__pressDone=resolve;window.__browserPress(JSON.stringify({x:rect.left+rect.width/2,y:rect.top+rect.height/2}));});
const until = async fn=>{for(let i=0;i<100;i++){if(fn())return;await pause();}throw Error('Fixture did not settle');};
const buttons = text=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text);
const regions = ()=>[...document.querySelectorAll('[data-loading-region]')].filter(el=>!el.closest('dialog'));
const rects = ()=>regions().map(el=>{const r=el.getBoundingClientRect();return {label:el.getAttribute('aria-label'),height:r.height,width:r.width,top:r.top+scrollY};});
const assert = (ok,message)=>{if(!ok)throw Error(message);};
const same = (before,after)=>{assert(before.length===after.length,'Panel count changed');before.forEach((r,i)=>['height','width','top'].forEach(key=>assert(Math.abs(r[key]-after[i][key])<1,r.label+' changed '+key+': '+r[key]+' -> '+after[i][key])));};
async function verify(){
  createRoot(document.getElementById('app')).render(<ABCDashboard isAdmin={false}/>);
  await until(()=>regions().length===4 && regions().every(el=>el.getAttribute('aria-busy')==='false') && document.querySelectorAll('tbody tr').length===25);
  const listChecks=[];
  for(const grouping of ['Produtos Olist','Produtos base','Clientes']) {
    buttons(grouping).click();await pause();await until(()=>regions().every(el=>!el.hasAttribute('data-loading')));
    const viewport=document.querySelector('[aria-label="Tabela do ranking ABC"]');
    const list=document.querySelector('[aria-label="Ranking ABC"]');
    const stable=rects();
    const positions=()=>({page:scrollY,top:viewport.scrollTop,left:viewport.scrollLeft});
    const unchanged=(before,label,boxes=stable)=>{const after=positions();for(const key of ['page','top','left']) assert(Math.abs(before[key]-after[key])<1,grouping+' '+label+' moved '+key+': '+JSON.stringify({before,after}));same(boxes,rects());};
    viewport.scrollTop=150;viewport.scrollLeft=60;
    const sort=viewport.querySelectorAll('thead button')[2];
    sort.scrollIntoView({block:'center'});sort.focus({preventScroll:true});viewport.scrollTop=150;await pause();
    const sortPosition=positions();pending=true;await press(sort);
    await until(()=>viewport.getAttribute('aria-busy')==='true');
    assert(regions().every(el=>!el.hasAttribute('data-loading')),'List update masked the analysis panels');
    assert(document.activeElement===sort && !sort.closest('[inert]'),'Sorting lost focus');
    assert(viewport.querySelector('tbody .skeleton'),'List update lacks row skeletons');
    unchanged(sortPosition,'sorting while pending');
    // Users may keep scrolling while the request is pending.
    viewport.scrollTop+=40;scrollBy(0,10);await pause();const responsePosition=positions();
    releases.report({...report(),rows:[...all].reverse().slice(0,25)});pending=false;
    await until(()=>viewport.getAttribute('aria-busy')==='false');
    unchanged(responsePosition,'sorted response');assert(document.activeElement===sort,'Sorting response lost focus');
    for(const count of [50,100,25]) {
      const select=list.querySelector('.app-select-trigger');
      select.scrollIntoView({block:'center'});select.focus({preventScroll:true});await pause();
      const position=positions();pending=true;delete releases.report;await press(select);
      await until(()=>document.querySelector('[role="option"][data-key="'+count+'"]'));
      const option=document.querySelector('[role="option"][data-key="'+count+'"]');await press(option);
      await until(()=>typeof releases.report==='function' && viewport.getAttribute('aria-busy')==='true');
      await pause();unchanged(position,'page size '+count+' pending');
      assert(document.activeElement===select,'Page size lost trigger focus: '+document.activeElement?.outerHTML.slice(0,700));
      releases.report({...report(),rows:all.slice(0,count)});pending=false;
      await until(()=>viewport.getAttribute('aria-busy')==='false');
      unchanged(position,'page size '+count+' response');assert(document.activeElement===select,'Page size response lost focus');
    }
    const next=list.querySelector('[aria-label="Próxima página"]');next.scrollIntoView({block:'center'});next.focus({preventScroll:true});await pause();
    let position=positions();next.click();await pause();await until(()=>viewport.getAttribute('aria-busy')==='false');
    unchanged(position,'pagination');assert(document.activeElement===next,'Pagination lost focus');
    const search=document.getElementById('abc-table-search');search.scrollIntoView({block:'center'});search.focus({preventScroll:true});await pause();position=positions();
    const setSearch=value=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(search,value);search.dispatchEvent(new Event('input',{bubbles:true}));};
    setSearch('Produto de teste 1');await pause();unchanged(position,'local search');assert(document.activeElement===search,'Search lost focus');
    setSearch('');await pause();
    const summary=list.querySelector('summary');summary.scrollIntoView({block:'center'});await pause();position=positions();
    await press(summary);await pause();
    assert(scrollY===position.page,'Opening columns moved the page');
    const open=rects(),checkbox=list.querySelector('input[type="checkbox"]');position=positions();await press(checkbox);await pause();
    unchanged(position,'column visibility',open);await press(checkbox);await pause();
    // Opening the disclosure intentionally changes height; compare its own box.
    await press(summary);await pause();same(stable,rects());
    listChecks.push({grouping,sorting:true,pageSizes:[50,100,25],pagination:true,search:true,columns:true,focus:true});
  }
  buttons('Produtos Olist').click();await pause();await until(()=>regions().every(el=>!el.hasAttribute('data-loading')));
  const before=rects();
  const ranking=document.querySelector('[aria-label="Tabela do ranking ABC"]');
  const chart=document.querySelector('[aria-label="Área rolável do gráfico de Pareto"]');
  ranking.scrollTop=90; ranking.scrollLeft=40; chart.scrollLeft=30;
  scrollTo(0,400); await pause(); const initialY=scrollY;
  pending=true; buttons('Últimos 7 dias').click(); await pause(); buttons('Analisar vendas').click();
  await until(()=>regions().every(el=>el.dataset.loading==='true'));
  const during=rects(); same(before,during);
  assert(scrollY===initialY,'Page scrolled when loading started');
  assert(regions().every(el=>el.querySelector('[data-loading-placeholder] .skeleton')),'A panel lacks skeletons');
  if(matchMedia('(prefers-reduced-motion: reduce)').matches) assert(getComputedStyle(document.querySelector('.skeleton')).animationName==='none','Reduced motion is ignored');
  assert(document.querySelector('[aria-label="Tabela do ranking ABC"]')===ranking,'Ranking viewport was remounted');
  assert(!ranking.closest('[inert]'),'Ranking scrolling became inert');
  assert(ranking.scrollTop===90,'Ranking scroll offset changed while loading');
  ranking.scrollTop+=40; chart.scrollLeft+=10; scrollTo(0,initialY+40); await pause();
  assert(ranking.scrollTop===130 && scrollY===initialY+40,'Scrolling stopped during loading');
  releases.report(report(120)); await pause();
  assert(regions().every(el=>el.dataset.loading==='true'),'Skeletons disappeared before comparison finished');
  releases.comparison(comparison); pending=false;
  await until(()=>regions().every(el=>!el.hasAttribute('data-loading')));
  const after=rects(); same(before,after);
  assert(scrollY===initialY+40,'Page scrolled after response');
  const expectedChartScroll=Math.min(40,chart.scrollWidth-chart.clientWidth);
  assert(ranking.scrollTop===130 && chart.scrollLeft===expectedChartScroll,'Valid scroll offsets were lost after response: '+JSON.stringify({table:ranking.scrollTop,chart:chart.scrollLeft,expectedChartScroll}));
  pending=true; buttons('Analisar vendas').click();
  await until(()=>regions().every(el=>el.dataset.loading==='true'));
  releases.report(report(0)); releases.comparison(comparison); pending=false;
  await until(()=>regions().every(el=>!el.hasAttribute('data-loading')));
  same(before,rects());
  assert(scrollY===initialY+40,'Empty result moved the page');
  assert(!document.querySelector('[aria-label="Tabela do ranking ABC"]').querySelector('tbody tr'),'Empty result retained visible rows');
  pending=true; buttons('Analisar vendas').click();
  await until(()=>regions().every(el=>el.dataset.loading==='true'));
  releases.report({error:'Erro simulado da consulta'},503);releases.comparison(comparison);pending=false;
  await until(()=>regions().every(el=>!el.hasAttribute('data-loading')));
  same(before,rects());assert(scrollY===initialY+40,'A failed response moved the page');
  assert(regions().every(el=>el.querySelector('[data-loading-content]').getAttribute('aria-hidden')==='true'),'Failure exposed old data as a new result');
  assert(document.documentElement.scrollWidth<=innerWidth,'The page overflows horizontally');
  return {passed:true,viewport:{width:innerWidth,height:innerHeight},listChecks,panels:before,scrollWhileLoading:true,scrollAfterResponse:true,emptyResultStable:true,failedResultStable:true,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
}
verify().then(result=>document.body.append(document.createComment('LAYOUT_RESULT:'+JSON.stringify(result)))).catch(error=>document.body.append(document.createComment('LAYOUT_RESULT:'+JSON.stringify({passed:false,error:error.stack}))));
`;

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abelha-loading-layout-'));
  const chrome = process.env.CHROME_PATH || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
  ].find(p=>fs.existsSync(p));
  if(!chrome) throw Error('Set CHROME_PATH to a Chrome/Chromium executable.');
  fs.writeFileSync(path.join(tmp,'entry.tsx'),fixture);
  fs.writeFileSync(path.join(tmp,'link.js'),`const React=require(${JSON.stringify(require.resolve('react'))});module.exports=({children,...props})=>React.createElement('a',props,children);`);
  fs.writeFileSync(path.join(tmp,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  await new Promise((resolve,reject)=>webpack({mode:'development',context:root,entry:path.join(tmp,'entry.tsx'),output:{path:tmp,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules')],alias:{'@':path.join(root,'src'),'next/link':path.join(tmp,'link.js')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(tmp,'loader.cjs')}]},plugins:[new webpack.DefinePlugin({'process.env.NODE_ENV':JSON.stringify('development')})],devtool:false},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  const css = await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')});
  fs.writeFileSync(path.join(tmp,'fixture.css'),css.css);
  fs.writeFileSync(path.join(tmp,'index.html'),'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="app" style="max-width:1500px;margin:auto;padding:24px"></div><script src="/fixture.js"></script></body></html>');
  const server=http.createServer((req,res)=>{const name=req.url==='/'?'index.html':req.url.slice(1);if(!['index.html','fixture.css','fixture.js'].includes(name)){res.writeHead(404).end();return;}res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(tmp,name)));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const results=[];
  const browser=await launchBrowser(chrome,tmp);
  browser.onBinding(message=>{(async()=>{
    const {x,y}=JSON.parse(message.params.payload),sessionId=message.sessionId;
    await browser.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y},sessionId);
    await browser.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1},sessionId);
    await browser.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1},sessionId);
    await browser.send('Runtime.evaluate',{expression:'window.__pressDone()'},sessionId);
  })().catch(console.error);});
  try {
    for(const [width,height] of [[1440,1000],[768,1000],[390,844]]) {
      const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
      const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
      await browser.send('Runtime.enable',{},sessionId);
      await browser.send('Runtime.addBinding',{name:'__browserPress'},sessionId);
      await browser.send('Page.bringToFront',{},sessionId);
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<640},sessionId);
      if(width<640) await browser.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]},sessionId);
      await browser.send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`},sessionId);
      const response=await browser.send('Runtime.evaluate',{expression:`new Promise(resolve=>{const timer=setInterval(()=>{const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_COMMENT);let node;while(node=walker.nextNode()){if(node.textContent.startsWith('LAYOUT_RESULT:')){clearInterval(timer);resolve(JSON.parse(node.textContent.slice(14)));return;}}},100);})`,awaitPromise:true,returnByValue:true},sessionId);
      const result=response.result.value || {passed:false,error:JSON.stringify(response)};
      const screenshot=await browser.send('Page.captureScreenshot',{format:'png'},sessionId);
      fs.writeFileSync(path.join(tmp,'viewport-'+width+'.png'),Buffer.from(screenshot.data,'base64'));
      await browser.send('Target.closeTarget',{targetId});
      results.push(result);console.log(JSON.stringify(result));
    }
  } finally { await browser.close();server.close(); }
  fs.writeFileSync(path.join(tmp,'results.json'),JSON.stringify(results,null,2));
  console.log('Layout evidence: '+path.join(tmp,'results.json'));
  if(results.some(result=>!result.passed))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
