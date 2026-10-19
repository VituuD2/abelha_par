require('./setup.cjs');
const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const fs=require('node:fs'),ts=require('typescript');
const dom=new JSDOM('<!doctype html><div id="app"></div>',{url:'http://localhost:3000/history'});
global.window=dom.window;global.document=dom.window.document;global.HTMLElement=dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT=true;
require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},
}).outputText,filename);
const React=require('react'),{act}=React,{createRoot}=require('react-dom/client');
const {default:History}=require('../src/app/history/page.tsx');
const root=createRoot(document.getElementById('app'));
after(async()=>{await act(async()=>root.unmount());dom.window.close();});
const order=(name,number)=>({id:number,clientName:name,numeroPedido:number,trackingCode:'AA123456789BR',status:'checked',dataCriacao:'2026-10-19'});
const batch={id:'batch-old',numero_lote:1,responsavel:'Equipe',created_at:'2025-01-01T12:00:00Z',qtd_pedidos:2,pedidos:[order('João encontrado',7925),order('Não corresponde',8123)]};
const input=()=>document.getElementById('history-search');
async function type(value){await act(async()=>{
  Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input(),value);
  input().dispatchEvent(new dom.window.Event('input',{bubbles:true}));
});}
async function submit(){await act(async()=>document.querySelector('form[role="search"]').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));}
const click=async element=>act(async()=>element.click());

test('history searches on the server, exposes matching orders in old batches, paginates and clears the query',async t=>{
  const requests=[];
  t.mock.method(global,'fetch',async url=>{
    requests.push(String(url));const p=new URL(url,'http://localhost').searchParams;
    return Response.json(p.has('q')?{batches:[{...batch,matchedOrders:[batch.pedidos[0]]}],total:21,matchingOrders:21}
      :{batches:[batch],total:62});
  });
  await act(async()=>root.render(React.createElement(History,{key:'search'})));
  assert.match(document.body.textContent,/62 lotes registrados/);
  assert.equal(document.querySelectorAll('input[type="search"]').length,1);
  await type('7925');assert.equal(requests.length,1);
  await act(async()=>new Promise(resolve=>setTimeout(resolve,350)));
  assert.equal(new URL(requests.at(-1),'http://localhost').searchParams.get('q'),'7925');
  await submit();
  assert.equal(new URL(requests.at(-1),'http://localhost').searchParams.get('q'),'7925');
  assert.match(document.body.textContent,/João encontrado/);
  assert.doesNotMatch(document.body.textContent,/Não corresponde/);
  assert.match(document.body.textContent,/1 de 2 pedidos encontrados/);
  assert.match(document.body.textContent,/Imprimir lote completo/);
  await click([...document.querySelectorAll('button')].find(b=>b.textContent==='Próxima'));
  assert.equal(new URL(requests.at(-1),'http://localhost').searchParams.get('page'),'2');
  await click(document.querySelector('[aria-label="Limpar busca"]'));
  assert.equal(input().value,'');assert.equal(new URL(requests.at(-1),'http://localhost').searchParams.has('q'),false);
  assert.match(document.body.textContent,/62 lotes registrados/);
});

test('late responses cannot replace a newer search and empty/error states recover without displaying old orders',async t=>{
  let resolveOld;
  t.mock.method(global,'fetch',async url=>{
    const q=new URL(url,'http://localhost').searchParams.get('q');
    if(q==='antiga')return new Promise(resolve=>{resolveOld=()=>resolve(Response.json({batches:[{...batch,matchedOrders:[order('Resultado obsoleto',1)]}],total:1,matchingOrders:1}));});
    if(q==='erro')return Response.json({error:'Busca indisponível'},{status:503});
    if(q==='nova')return Response.json({batches:[{...batch,matchedOrders:[order('Resultado atual',2)]}],total:1,matchingOrders:1});
    return Response.json({batches:[],total:0,matchingOrders:0});
  });
  await act(async()=>root.render(React.createElement(History,{key:'race'})));
  await type('antiga');await submit();
  await type('nova');await submit();
  assert.match(document.body.textContent,/Resultado atual/);
  await act(async()=>resolveOld());
  assert.doesNotMatch(document.body.textContent,/Resultado obsoleto/);
  await type('erro');await submit();
  assert.match(document.querySelector('[role="alert"]').textContent,/Busca indisponível/);
  assert.doesNotMatch(document.body.textContent,/Resultado atual/);
  await type('inexistente');await submit();
  assert.match(document.body.textContent,/Nenhum pedido encontrado/);
  assert.equal(document.querySelector('[role="alert"]'),null);
});
