// Read-only production diagnosis: no refresh, RPC claims, queue changes or ERP writes.
require('../tests/setup.cjs');
require('dotenv').config({quiet:true});
const fs=require('node:fs'),path=require('node:path');
const {createClient}=require('@supabase/supabase-js');
const {decryptToken}=require('../src/lib/token-crypto.ts');
const {normalizeCostHistoryPage}=require('../src/lib/analytics/cost-history-sync.ts');
const workspace=require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const fita=process.argv.includes('--fita-seios');
const skus=fita?['ACFS000-K001']:'ACTM000-K010 ACTM001-K002 CMPO00B-K001 CMPO00C-K001 CMPO00N-K001 CMPO0B3-K001 DDCO00A-K001 DDCO00C-K001 DDCO00N-K001 DDCO00U-K001 DDCO00V-K001 SBGF00M-K001 SBLL001-K001'.split(' ');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})}});
const checked=(result,label)=>{if(result.error)throw Error(`${label}: ${result.error.code||'read failed'} ${result.error.message}`);return result.data;};
async function main(){
 const company=checked(await db.from('analytics_companies').select('id').eq('workspace_id',workspace).eq('tax_id','13397731000164').single(),'company');
 const connection=checked(await db.from('analytics_connections').select('id,name,enabled,access_token,expires_at,sync_locked_until,last_processed_at').eq('workspace_id',workspace).eq('company_id',company.id).single(),'connection');
 const queries=await Promise.all([
  db.from('analytics_cost_sync').select('*').eq('workspace_id',workspace),
  db.from('analytics_cost_history_sync').select('*').eq('workspace_id',workspace).in('sku',skus),
  db.from('analytics_product_costs').select('external_id,sku,cost_cents,active,checked_at,provider_revision').eq('workspace_id',workspace).in('sku',skus),
  db.from('analytics_cost_events').select('external_id,sku,effective_at,effective_day,purchase_cents,average_cents,current').eq('workspace_id',workspace).in('sku',skus).eq('current',true).order('effective_at',{ascending:false}).limit(1000),
  db.rpc('analytics_cost_history_status',{p_workspace:workspace},{get:true}),
 ]);
 const [sync,jobs,products,events,status]=queries.map((r,i)=>checked(r,['sync','jobs','products','events','status'][i]));
 const result={at:new Date().toISOString(),readOnly:true,connection:{name:connection.name,enabled:connection.enabled,sync_locked_until:connection.sync_locked_until,last_processed_at:connection.last_processed_at},sync,status,jobs,products,events,eventLimit:1000};
 console.log(JSON.stringify(result,null,2));
 if(process.argv.includes('--report')){
  const {compositionRulesForWorkspace}=require('../src/lib/analytics/composition-server.ts');
  const member=checked(await db.from('workspace_members').select('user_id').eq('workspace_id',workspace).eq('active',true).limit(1).single(),'active member');
  result.reports=[];
  for(const costBasis of ['average','purchase']){
   const filters={from:fita?'2026-09-01':'2026-09-21',to:fita?'2026-09-30':'2026-10-20',metric:'revenue',mode:'TINY_LEGACY',grouping:'composition',basis:'orders',costBasis,thresholdA:80,thresholdB:95,selections:{statuses:['1','5','6']}};
   // Read-only report RPC uses POST because the reviewed catalog exceeds URL limits.
   const response=await db.rpc('analytics_abc_components_v19',{p_workspace:workspace,p_actor:member.user_id,p_filters:filters,p_rules:compositionRulesForWorkspace(workspace),p_offset:0,p_limit:50,p_sort:'rank',p_direction:'asc'});
   const data=response.data;
   result.reports.push({filters,error:response.error?{code:response.error.code,message:response.error.message}:null,total:data?.total,revenue:data?.revenue,composition:data?.composition});
  }
  console.log(JSON.stringify({reports:result.reports},null,2));
  if(fita){
   const filters={...result.reports.find(r=>r.filters.costBasis==='purchase').filters,metric:'quantity'};
   const detail=checked(await db.rpc('analytics_drilldown_components_v19',{p_workspace:workspace,p_actor:member.user_id,p_filters:filters,p_rules:compositionRulesForWorkspace(workspace),p_entity:'composition:ACFS000-K001',p_offset:0}),'component detail');
   // Product/order references only; never customer data or credentials.
   result.affected={total:detail.total,sources:detail.sources,orders:detail.orders?.map(o=>({id:o.id,date:o.date,status:o.status,company:o.company,quantity:o.quantity}))};
   console.log(JSON.stringify({affected:result.affected},null,2));
  }
 }
 if(process.argv.includes('--provider')){
  if(!connection.access_token||!(Date.parse(connection.expires_at||'')>Date.now()))throw Error('Stored token expired/missing; no refresh performed.');
  const token=decryptToken(connection.access_token);let previous=0;
  async function get(resource){await new Promise(resolve=>setTimeout(resolve,Math.max(0,previous+3000-Date.now())));previous=Date.now();const response=await fetch('https://api.tiny.com.br/public-api/v3'+resource,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});if(!response.ok)return{httpStatus:response.status};return response.json();}
  const identity=await get('/info');if(String(identity.cpfCnpj).replace(/\D/g,'')!=='13397731000164')throw Error('ERP identity mismatch.');
  result.provider=[];
  for(const sku of fita?skus:['ACTM001-K002','SBLL001-K001','DDCO00A-K001']){
   const product=products.find(p=>p.sku===sku);if(!product)continue;
   const raw=await get(`/produtos/${product.external_id}/custos?limit=100&offset=0`);
   // Persist only cost fields: exclude unrelated provider data.
   const sanitized={httpStatus:raw.httpStatus,paginacao:raw.paginacao,itens:Array.isArray(raw.itens)?raw.itens.map(e=>({data:e.data,precoCusto:e.precoCusto,custoMedio:e.custoMedio,saldoAnterior:e.saldoAnterior,saldoAtual:e.saldoAtual,impostosRecuperaveis:e.impostosRecuperaveis})):undefined};
   let normalization;try{const page=normalizeCostHistoryPage(raw,0);normalization={ok:true,count:page.count,done:page.done};}catch(e){normalization={ok:false,error:e.message};}
   result.provider.push({sku,external_id:product.external_id,...sanitized,normalization});
  }
  console.log(JSON.stringify({provider:result.provider},null,2));
 }
 const directory=path.join('docs','evidencias','olist-cmv-'+new Date().toISOString().replace(/\D/g,'').slice(0,14));fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'diagnostico.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({directory}));
}
main().catch(e=>{console.error(JSON.stringify({error:e.message,readOnly:true}));process.exitCode=1;});
