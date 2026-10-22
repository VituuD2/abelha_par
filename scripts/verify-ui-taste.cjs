/* Render actual UI components with isolated synthetic data, never production.
 * Run node scripts/verify-ui-taste.cjs. Captures and JSON go to a temp directory. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { launchBrowser } = require('./verify-loading-layout.cjs');
const nextWebpack = require('next/dist/compiled/webpack/webpack');
nextWebpack.init();
const root = path.resolve(__dirname, '..');

const fixture = String.raw`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {Sidebar} from '@/components/layout/sidebar';
import {Header} from '@/components/layout/header';
import Home from '@/app/page';
import Orders from '@/app/orders/page';
import Scanner from '@/app/scanner/page';
import History from '@/app/history/page';
import Login from '@/app/login/page';
import Forgot from '@/app/forgot-password/page';
import Reset from '@/app/reset-password/page';
import {ABCDashboard} from '@/components/analytics/abc-dashboard';
import {NinhoSettings} from '@/components/ninho/ninho-settings';
import {usePreparationStore} from '@/stores/preparation-store';
import {useScanStore} from '@/stores/scan-store';
const errors=[];
window.addEventListener('error',event=>errors.push(event.message));
window.addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
const date='2026-10-22T13:00:00Z';
const scanOrders=Array.from({length:12},(_,i)=>({id:i+1,nuvemshopId:i+1,nuvemshopNumber:String(1000+i),yampiId:String(i+1),trackingCode:'BR0000000'+i+'BR',clientName:i===1?'Cliente de demonstração com nome extenso para verificar a leitura na tela':'Cliente de demonstração '+(i+1),numeroPedido:2000+i,dataCriacao:date,situacao:5,status:i<4?'checked':'pending',scannedAt:i<4?date:undefined}));
const shopOrders=scanOrders.map((row,i)=>({id:row.id,storeId:'demo',number:row.nuvemshopNumber,clientName:row.clientName,status:'open',paymentStatus:'paid',shippingStatus:'unpacked',createdAt:date,updatedAt:date,total:String(100+i*10),currency:'BRL'}));
const session={id:'demo-session',responsible:'Operador de demonstração',orders:scanOrders,revision:1,status:'active',batch_id:null};
const batches=Array.from({length:4},(_,i)=>({id:'batch-'+i,numero_lote:40+i,responsavel:'Equipe de demonstração',created_at:date,data:date,qtd_pedidos:12,pedidos:scanOrders,matchedOrders:scanOrders.slice(0,2)}));
const mapping={ecommerceId:1,referenceField:'ecommerceOrderNumber',referenceKind:'number'};
const analytics={companies:[{id:'co',name:'Empresa de demonstração',tax_id:null}],connections:[{id:'c',company_id:'co',name:'Olist demonstração',enabled:true,credential_kind:'oauth',verified_at:date,verified_tax_id:null,last_synced_at:date,last_error:null,expires_at:'2100-01-01'}],sources:[],coverage:[{connection_id:'c',mode:'backfill',status:'completed',from_date:'2020-01-01',to_date:'2100-01-01'}],jobs:[],options:{}};
const rows=Array.from({length:100},(_,i)=>({entityId:'p'+i,name:'Produto de demonstração '+(i+1),sku:'DEMO-'+(i+1),rank:i+1,revenue:'24000',quantity:'12',orders:2,class:i<80?'A':i<95?'B':'C',percent:1,cumulativeBefore:i,cumulative:i+1}));
const report={rows:rows.slice(0,25),pareto:rows,total:100,revenue:'2400000',quantity:'1200',orders:200,top10:10,generatedAt:date,classes:{A:{count:80,revenue:'1920000',quantity:'960',percent:80},B:{count:15,revenue:'360000',quantity:'180',percent:15},C:{count:5,revenue:'120000',quantity:'60',percent:5}}};
window.fetch=async(input,init={})=>{
  const url=new URL(String(input),location.origin),p=url.pathname;
  let data;
  if(p==='/api/auth/status')data={isConnected:true,status:'connected',message:null};
  else if(p==='/api/nuvemshop/connection')data={connected:true,storeId:'demo',mapping};
  else if(p==='/api/nuvemshop/orders')data={orders:shopOrders,hasMore:false};
  else if(p==='/api/ninho/webhook')data={enabled:true,url:null,status:{status:'active',lastReceivedAt:date}};
  else if(p==='/api/ninho/users')data={users:[{user_id:'demo',name:'Operador de demonstração',email:'operador@example.test',role:'admin',active:true}],currentUserId:'demo'};
  else if(p==='/api/scan-sessions')data={sessions:[{id:session.id,responsible:session.responsible,checked:4,total:12,updatedAt:date}]};
  else if(p.startsWith('/api/scan-sessions/'))data={session};
  else if(p==='/api/batches')data={batches,total:4,matchingOrders:8};
  else if(p==='/api/analytics/coverage')data={sync:{scheduled:0}};
  else if(p==='/api/analytics/abc')data=report;
  else if(p==='/api/analytics/drilldown')data={total:1,companies:[{name:'Empresa de demonstração',revenue:'24000',quantity:'12',orders:1}],channels:[{name:'Nuvemshop',revenue:'24000',quantity:'12',orders:1}],orders:[{id:'1',number:'1001',date:'22/10/2026',status:5,company:'Empresa de demonstração',source:'Nuvemshop',connection:'Olist demonstração',revenue:'24000',quantity:'12'}]};
  else if(p==='/api/analytics/comparison')data={period:{from:'2026-09-01',to:'2026-09-30'},previous:{revenue:'2000000',quantity:'1000',orders:180,total:90,top10:12}};
  else if(p==='/api/analytics/api-usage')data={available:true,generated_at:date,accounts:[]};
  else if(p.startsWith('/api/analytics/'))data=analytics;
  else if(p==='/api/olist')data={orders:scanOrders,mapping,nextCursor:null};
  else throw Error('Unmapped fixture request: '+p+' '+init.method);
  return Response.json(data);
};
usePreparationStore.getState().setNuvemshopOrders(shopOrders);
usePreparationStore.getState().setSelectedIds([1,2]);
usePreparationStore.getState().confirmSelection();
if(location.pathname==='/scanner')useScanStore.getState().setSession(session);
const screens={'/':Home,'/orders':Orders,'/scanner':Scanner,'/history':History,'/login':Login,'/forgot-password':Forgot,'/reset-password':Reset,'/analytics/abc':()=> <ABCDashboard isAdmin={false}/>,'/ninho':()=> <><Header title="Ninho" breadcrumbs={['Abelha Par','Ninho']} description="Gerencie as conexões da colmeia e os acessos da equipe."/><NinhoSettings/></>};
const Screen=screens[location.pathname];
const isAuth=['/login','/forgot-password','/reset-password'].includes(location.pathname);
createRoot(document.getElementById('app')).render(isAuth?<Screen/>:<><Sidebar role="admin"/><main id="app-main" className="app-main min-h-screen"><div className="app-content"><Screen/></div></main></>);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await wait(50);}throw Error('UI did not settle: '+location.pathname);};
const visible=el=>!!el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
const button=text=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text && visible(el));
window.__exercise=async()=>{
  const checks=[];
  if(location.pathname==='/history') {document.querySelector('[aria-expanded="false"]').click();await wait(300);if(!button('Imprimir resultado'))throw Error('History detail inaccessible');checks.push('expand history batch');}
  if(location.pathname==='/orders') {const checkbox=document.querySelector('tbody input');const before=checkbox.checked;checkbox.click();await wait(100);if(checkbox.checked===before)throw Error('Order checkbox did not update');checks.push('select order');}
  if(location.pathname==='/analytics/abc') {button('Mais filtros').click();await wait(100);if(!document.getElementById('abc-extra-filters'))throw Error('Filters inaccessible');button('Recolher filtros').click();await wait(100);document.querySelector('tbody tr button').click();await until(()=>document.querySelector('dialog[open] tbody tr'));const dialog=document.querySelector('dialog[open]');if(dialog.scrollWidth>dialog.clientWidth+1)throw Error('Detail dialog overflows horizontally');dialog.querySelector('[aria-label="Fechar detalhes"]').click();await wait(100);if(document.querySelector('dialog[open]'))throw Error('Detail dialog did not close');checks.push('expand/collapse analysis filters','open/close order detail');}
  if(location.pathname==='/ninho') {document.querySelector('button[aria-label="Olist ERP"]').click();await wait(100);if(document.querySelector('button[aria-label="Olist ERP"]').getAttribute('aria-expanded')!=='true')throw Error('Connection disclosure inaccessible');button('Usuários e permissões').click();await wait(150);if(document.getElementById('ninho-users').hidden)throw Error('Users panel inaccessible');checks.push('connection disclosure','users tab');}
  return checks;
};
const luminance=color=>{const values=color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>{n/=255;return n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722;};
window.__audit=()=>{
  if(errors.length)throw Error(errors.join('\n'));
  if(document.querySelectorAll('h1').length!==1)throw Error('Expected one main heading');
  if(document.documentElement.scrollWidth>innerWidth+1)throw Error('Horizontal page overflow: '+document.documentElement.scrollWidth+'/'+innerWidth);
  for(const panel of document.querySelectorAll('[data-loading-region][aria-label="Indicadores do período"], [data-loading-region][aria-label="Lotes em andamento"]'))if(panel.scrollHeight>panel.clientHeight+2)throw Error('First result was clipped in '+panel.getAttribute('aria-label'));
  const probe=document.createElement('span');probe.style.cssText='position:absolute;visibility:hidden;color:var(--color-text-tertiary);background:var(--color-bg-elevated)';document.body.append(probe);const style=getComputedStyle(probe),a=luminance(style.color),b=luminance(style.backgroundColor),contrast=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);probe.remove();
  if(contrast<4.5)throw Error('Muted text token contrast '+contrast);
  const nav=document.querySelector('.app-mobile-nav');if(nav && visible(nav)){for(const link of nav.querySelectorAll('a')){const rect=link.getBoundingClientRect();if(rect.height<44)throw Error('Mobile navigation target too small');}}
  return {route:location.pathname,width:innerWidth,height:innerHeight,horizontalOverflow:false,mainHeadings:1,mutedTextOnPanelContrast:Number(contrast.toFixed(2)),runtimeErrors:errors};
};
(async()=>{await document.fonts.ready;await until(()=>document.querySelector('h1') && !document.querySelector('[data-loading="true"]'));await wait(450);window.__ready=true;})().catch(error=>errors.push(String(error)));
`;

(async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'abelha-ui-taste-'));
  const chrome=process.env.CHROME_PATH || ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','/usr/bin/google-chrome','/usr/bin/chromium'].find(fs.existsSync);
  if(!chrome)throw Error('Set CHROME_PATH to a Chrome/Chromium executable.');
  fs.writeFileSync(path.join(tmp,'entry.tsx'),fixture);
  fs.writeFileSync(path.join(tmp,'loader.cjs'),`const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(s){return ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  fs.writeFileSync(path.join(tmp,'link.js'),`const React=require(${JSON.stringify(require.resolve('react'))});module.exports=({children,...props})=>React.createElement('a',props,children);`);
  fs.writeFileSync(path.join(tmp,'navigation.js'),`exports.usePathname=()=>location.pathname;exports.useRouter=()=>({push(){},replace(){},refresh(){}});`);
  fs.writeFileSync(path.join(tmp,'access.js'),`exports.useAppAccess=()=>({can:()=>true});`);
  fs.writeFileSync(path.join(tmp,'supabase.js'),`exports.createClient=()=>({auth:{getSession:async()=>({data:{session:{user:{id:'demo'}}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signInWithPassword:async()=>({error:{message:'Synthetic login'}}),resetPasswordForEmail:async()=>({error:null}),updateUser:async()=>({error:null}),signOut:async()=>({error:null})}});`);
  await new Promise((resolve,reject)=>nextWebpack.webpack({mode:'development',context:root,entry:path.join(tmp,'entry.tsx'),output:{path:tmp,filename:'fixture.js'},resolve:{extensions:['.tsx','.ts','.js'],modules:[path.join(root,'node_modules')],alias:{'@/components/layout/app-shell':path.join(tmp,'access.js'),'@/lib/supabase/client':path.join(tmp,'supabase.js'),'@':path.join(root,'src'),'next/link':path.join(tmp,'link.js'),'next/navigation':path.join(tmp,'navigation.js')}},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:path.join(tmp,'loader.cjs')}]},plugins:[new nextWebpack.webpack.DefinePlugin({'process.env.NODE_ENV':JSON.stringify('development')})],devtool:false},(error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve()));
  const css=await require('postcss')([require('@tailwindcss/postcss')({base:root})]).process(fs.readFileSync(path.join(root,'src/app/globals.css'),'utf8'),{from:path.join(root,'src/app/globals.css')});
  fs.writeFileSync(path.join(tmp,'fixture.css'),css.css);
  // Use the project's already-built, licensed Inter face when available.
  const fontPath=path.join(root,'.next/static/media/e4af272ccee01ff0-s.p.woff2');
  const hasFont=fs.existsSync(fontPath);
  if(hasFont){fs.copyFileSync(fontPath,path.join(tmp,'inter.woff2'));fs.appendFileSync(path.join(tmp,'fixture.css'),'\n@font-face{font-family:Inter;src:url(/inter.woff2) format("woff2");font-weight:100 900;font-style:normal;font-display:block;}');}
  fs.writeFileSync(path.join(tmp,'index.html'),'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="app"></div><script src="/fixture.js"></script></body></html>');
  const server=http.createServer((req,res)=>{const file=req.url==='/fixture.css'?'fixture.css':req.url==='/fixture.js'?'fixture.js':req.url==='/inter.woff2'&&hasFont?'inter.woff2':'index.html';res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.woff2')?'font/woff2':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(tmp,file)));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await launchBrowser(chrome,tmp),results=[];
  try {
    for(const [width,height] of [[1536,1024],[768,1024],[390,844]]) {
      for(const route of ['/analytics/abc','/','/orders','/history','/scanner','/ninho','/login','/forgot-password','/reset-password']) {
        const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
        const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
        const evaluate=async expression=>{const {result,exceptionDetails}=await browser.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(exceptionDetails)throw Error(exceptionDetails.exception?.description||exceptionDetails.text);return result.value;};
        try {
          await browser.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<640},sessionId);
          await browser.send('Page.bringToFront',{},sessionId);
          await browser.send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+route},sessionId);
          await evaluate(`new Promise((resolve,reject)=>{let tries=0;const t=setInterval(()=>{if(window.__ready){clearInterval(t);resolve(true);}else if(++tries>150){clearInterval(t);reject(Error('Preview did not become ready'));}},50);})`);
          const result=await evaluate('window.__audit()');
          const name=(route==='/'?'home':route.slice(1).replaceAll('/','-'))+'-'+width;
          const capture=await browser.send('Page.captureScreenshot',{format:'png'},sessionId);
          fs.writeFileSync(path.join(tmp,name+'.png'),Buffer.from(capture.data,'base64'));
          result.controls=await evaluate('window.__exercise()');
          await evaluate('window.__audit()');
          results.push({passed:true,...result,font:hasFont?'Inter from project build':'system fallback'});console.log('PASS '+route+' '+width);
        } catch(error) {results.push({passed:false,route,width,error:String(error)});console.error('FAIL '+route+' '+width+': '+error.message);}
        finally {await browser.send('Target.closeTarget',{targetId});}
      }
    }
  } finally {await browser.close();server.close();}
  fs.writeFileSync(path.join(tmp,'results.json'),JSON.stringify(results,null,2));
  console.log('Visual evidence: '+path.join(tmp,'results.json'));
  if(results.some(result=>!result.passed))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
