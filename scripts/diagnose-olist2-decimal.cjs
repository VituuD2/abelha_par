// Production GET only: scoped checkpoint and blocked order, no OAuth refresh or writes.
require('../tests/setup.cjs');
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path');
const {createClient}=require('@supabase/supabase-js');
const {decryptToken}=require('../src/lib/token-crypto.ts');
const {decimalUnits}=require('../src/lib/analytics/engine.ts');
const {normalizeOrder}=require('../src/lib/analytics/normalize.ts');
const catalog=require('../src/lib/analytics/data/composition-catalog.json');
const workspace=catalog.workspaceIds[0],tax='36965322000112';
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
 auth:{persistSession:false,autoRefreshToken:false},
 global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})},
});
const checked=(result,label)=>{if(result.error)throw Error(`${label}: ${result.error.code||'read failed'}`);return result.data;};
async function main(){
 const company=checked(await db.from('analytics_companies').select('id,name,tax_id').eq('workspace_id',workspace).eq('tax_id',tax).single(),'company');
 const connection=checked(await db.from('analytics_connections').select('id,name,credential_kind,legacy_integration_id,access_token,expires_at').eq('workspace_id',workspace).eq('company_id',company.id).single(),'connection');
 const jobs=checked(await db.from('analytics_sync_jobs').select('id,mode,status,from_date,to_date,cursor_date,page_offset,pages,processed,pending_ids,pending_index,attempts,last_error,next_at,updated_at').eq('workspace_id',workspace).eq('connection_id',connection.id).eq('mode','backfill').eq('from_date','2026-08-01').eq('to_date','2026-10-02'),'jobs');
 const job=jobs.find(j=>j.status!=='completed'&&/decimal/i.test(j.last_error||''));
 if(!job){console.log(JSON.stringify({connection:connection.name,jobs:jobs.map(({pending_ids,...j})=>({...j,pendingCount:pending_ids.length})),message:'No matching decimal-blocked checkpoint; no provider request made.'},null,2));return;}
 let stored=connection;
 if(connection.credential_kind==='legacy')stored=checked(await db.from('tiny_integrations').select('access_token,expires_at').eq('workspace_id',workspace).eq('id',connection.legacy_integration_id).single(),'legacy');
 if(!stored?.access_token||!(Date.parse(stored.expires_at||'')>Date.now()))throw Error('Stored token expired/missing; no OAuth refresh performed.');
 const token=decryptToken(stored.access_token);let previous=0;
 async function get(resource){
  await new Promise(resolve=>setTimeout(resolve,Math.max(0,previous+3000-Date.now())));previous=Date.now();
  const response=await fetch('https://api.tiny.com.br/public-api/v3'+resource,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw Error(`Olist GET ${resource} HTTP ${response.status}`);
  return response.json();
 }
 const identity=await get('/info');if(String(identity.cpfCnpj).replace(/\D/g,'')!==tax)throw Error('ERP identity mismatch; stopped before reading order.');
 const pending=String(job.pending_ids[job.pending_index]);if(!/^\d+$/.test(pending))throw Error('No valid pending order ID.');
 const raw=await get('/pedidos/'+pending);if(String(raw.id)!==pending)throw Error('ERP returned another order.');
 const invalid=[],fields=['valorTotalPedido','valorTotalProdutos','valorDesconto'];
 const inspect=(field,value)=>{try{decimalUnits(String(value));}catch{invalid.push({field,value,type:typeof value});}};
 for(const field of fields)if(raw[field]!==undefined&&raw[field]!==null)inspect(field,raw[field]);
 const itens=(raw.itens||[]).map((item,index)=>{
  inspect(`itens[${index}].quantidade`,item.quantidade);inspect(`itens[${index}].valorUnitario`,item.valorUnitario);
  return{produto:{id:item.produto?.id,sku:item.produto?.sku},quantidade:item.quantidade,valorUnitario:item.valorUnitario};
 });
 const input={id:raw.id,data:raw.data,dataCriacao:raw.dataCriacao,situacao:raw.situacao,cliente:{},itens};
 for(const field of fields)if(raw[field]!==undefined)input[field]=raw[field];
 let normalization;
 try{const result=normalizeOrder(input,connection.id,connection.id,new Date().toISOString());normalization={ok:true,totalCents:result.order.total_cents,discountCents:result.order.discount_cents,qualityFlags:result.order.quality_flags};}
 catch(error){normalization={ok:false,error:error.message};}
 const {pending_ids,...checkpoint}=job;
 const result={at:new Date().toISOString(),readOnly:true,connection:connection.name,identityConfirmed:true,checkpoint:{...checkpoint,pendingCount:pending_ids.length,pendingOrderId:pending},invalidFields:invalid,normalization,sanitizedInput:input};
 const directory=path.join('docs','evidencias','olist2-decimal-'+new Date().toISOString().replace(/\D/g,'').slice(0,14));fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,'diagnostico.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({directory,...result},null,2));
}
main().catch(error=>{console.error(JSON.stringify({error:error.message,readOnly:true}));process.exitCode=1;});
