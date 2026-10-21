// GET-only ID reconciliation and update-filter overlap sample. No refresh, scheduling or production writes.
require('../tests/setup.cjs');require('dotenv').config({quiet:true});
const fs=require('node:fs'),{createClient}=require('@supabase/supabase-js');
const {decryptToken}=require('../src/lib/token-crypto.ts');
const workspace=require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(15000)})}});
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
const from='2026-10-01';
const only=process.argv.find(arg=>arg.startsWith('--connection='))?.slice(13);
const creationOnly=process.argv.includes('--creation-only');
const overlapOnly=process.argv.includes('--overlap-only');
const boundedUpdates=process.argv.includes('--bounded-updates');
const dir='docs/evidencias/importacao-requests-'+new Date().toISOString().replace(/\D/g,'').slice(0,14);
const out={startedAt:new Date().toISOString(),readOnly:true,from,to:today,accounts:[]};
const checked=r=>{if(r.error)throw Error('Database '+r.error.code);return r.data||[];};
const dayAfter=d=>new Date(Date.parse(d+'T12:00:00Z')+86400000).toISOString().slice(0,10);
function save(){fs.writeFileSync(dir+'/audit.json',JSON.stringify(out,null,2)+'\n');}
async function main(){
 fs.mkdirSync(dir,{recursive:true});
 const connections=checked(await db.from('analytics_connections').select('id,name,credential_kind,legacy_integration_id,access_token,expires_at,verified_tax_id').eq('workspace_id',workspace).eq('enabled',true).order('name'));
 const jobs=checked(await db.from('analytics_sync_jobs').select('connection_id,cursor_date,query_phase').eq('workspace_id',workspace).eq('mode','incremental').neq('status','completed'));
 await Promise.all(connections.filter(c=>!only||c.id===only).map(async c=>{
  const entry={name:c.name,requests:[],creationPages:[],missingActiveIds:[]};out.accounts.push(entry);
  try{
   const stored=c.credential_kind==='legacy'?checked(await db.from('tiny_integrations').select('access_token,expires_at').eq('workspace_id',workspace).eq('id',c.legacy_integration_id).single()):c;
   if(!stored.access_token||!(Date.parse(stored.expires_at)>Date.now()))throw Error('Expired credential; no refresh attempted');
   const token=decryptToken(stored.access_token);let previous=0;
   async function get(path,category){
    await new Promise(r=>setTimeout(r,Math.max(0,previous+5000-Date.now())));previous=Date.now();
    const started=Date.now();const response=await fetch('https://api.tiny.com.br/public-api/v3'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
    const remaining=response.headers.get('x-ratelimit-remaining');
    entry.requests.push({category,status:response.status,milliseconds:Date.now()-started,remaining:remaining===null?null:Number(remaining)});
    if(!response.ok){
     const errorBody=await response.json().catch(()=>null);
     const sanitize=value=>String(value||'').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/[A-Za-z0-9_-]{40,}/g,'[redacted]').replace(/\b\d{11,14}\b/g,'[redacted-id]').slice(0,300);
     entry.providerError={status:response.status,category,message:sanitize(errorBody?.mensagem||errorBody?.message),fields:Array.isArray(errorBody?.detalhes)?errorBody.detalhes.map(d=>sanitize(d.campo)):[]};
     throw Error('Olist HTTP '+response.status+'; account audit stopped');
    }
    const body=await response.json();
    if(remaining!==null&&Number(remaining)<=10)throw Error('Low provider quota; audit stopped');
    return body;
   }
   if(String((await get('/info','identity')).cpfCnpj).replace(/\D/g,'')!==c.verified_tax_id)throw Error('Identity mismatch');
   const job=jobs.find(j=>j.connection_id===c.id);
   if(boundedUpdates&&job){
    entry.boundedUpdates=[];
    const date=dayAfter(job.cursor_date);
    for(const [start,end] of [['2026-10-01','2026-10-07'],['2026-10-08','2026-10-14'],['2026-10-15',today]]){
     const body=await get('/pedidos?'+new URLSearchParams({dataAtualizacao:date,dataInicial:start,dataFinal:end,limit:'100',offset:'0',orderBy:'desc'}),'bounded-updates');
     const dates=body.itens.map(row=>String(row.dataCriacao).slice(0,10)).sort();
     entry.boundedUpdates.push({updatedSince:date,from:start,to:end,total:body.paginacao.total,sampleSize:dates.length,firstCreation:dates[0]||null,lastCreation:dates.at(-1)||null,allWithinWindow:dates.every(d=>d>=start&&d<=end)});save();
    }
    entry.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({directory:dir,name:c.name,boundedUpdates:entry.boundedUpdates,requests:entry.requests}));return;
   }
   if(job&&!creationOnly){
    const samples=[];
    for(const day of [job.cursor_date,dayAfter(job.cursor_date)]){
     const body=await get('/pedidos?'+new URLSearchParams({dataAtualizacao:day,limit:'100',offset:'0',orderBy:'desc'}),'updates-overlap');
     if(!Array.isArray(body.itens))throw Error('Invalid update page');
     const ids=new Set(body.itens.map(row=>String(row.id)));
     samples.push({day,total:Number(body.paginacao?.total),ids,rows:body.itens.map(row=>({id:String(row.id),created:row.dataCriacao}))});
    }
    const common=[...samples[0].ids].filter(id=>samples[1].ids.has(id));
    entry.overlap={dates:samples.map(s=>s.day),totals:samples.map(s=>s.total),sampleSizes:samples.map(s=>s.ids.size),commonIds:common.length,
     sampleCreationDates:[...new Set(samples.flatMap(s=>s.rows.map(row=>row.created)))].sort()};
    save();
   }
   if(overlapOnly){entry.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({directory:dir,name:c.name,overlap:entry.overlap}));return;}
   const source=new Map();let initialTotal=null;
   for(let offset=0;offset<10000;offset+=100){
    const body=await get('/pedidos?'+new URLSearchParams({dataInicial:from,dataFinal:today,limit:'100',offset:String(offset),orderBy:'asc'}),'creation-list');
    const total=Number(body.paginacao?.total);
    if(!Array.isArray(body.itens)||!Number.isSafeInteger(total)||total<0)throw Error('Invalid creation page');
    initialTotal??=total;
    entry.creationPages.push({offset,total,count:body.itens.length});
    for(const row of body.itens){const id=String(row.id);if(!/^\d+$/.test(id))throw Error('Invalid order identifier');source.set(id,{id,status:Number(row.situacao)});}
    save();
    if(offset+body.itens.length>=total||body.itens.length<100){entry.creationComplete=true;break;}
   }
   // Match by immutable ERP ID, independently of commercial sale_date in local reports.
   const local=new Map();const ids=[...source.keys()];
   for(let offset=0;offset<ids.length;offset+=100){
    const rows=checked(await db.from('analytics_orders').select('external_id,status').eq('workspace_id',workspace).eq('connection_id',c.id).in('external_id',ids.slice(offset,offset+100)));
    for(const row of rows)local.set(String(row.external_id),Number(row.status));
   }
   const active=[...source.values()].filter(row=>row.status!==2);
   entry.initialSourceTotal=initialTotal;entry.sourceUnique=source.size;entry.sourceActive=active.length;entry.sourceCancelled=source.size-active.length;
   entry.matchedActive=active.filter(row=>local.has(row.id)).length;
   entry.missingActiveIds=active.filter(row=>!local.has(row.id)).map(row=>row.id);
   entry.missingActive=entry.missingActiveIds.length;
   entry.statusDifferences=[...source.values()].filter(row=>local.has(row.id)&&local.get(row.id)!==row.status).length;
   entry.missingCancelled=[...source.values()].filter(row=>row.status===2&&!local.has(row.id)).length;
   entry.sourceTotalsChanged=entry.creationPages.some(p=>p.total!==initialTotal);
  }catch(e){entry.error=e.name==='TimeoutError'?'Source timeout; no further requests for this account':e.message;}
  entry.finishedAt=new Date().toISOString();save();
  const {missingActiveIds,requests,creationPages,...summary}=entry;
  console.log(JSON.stringify({directory:dir,...summary,httpRequests:requests.length}));
 }));
 out.finishedAt=new Date().toISOString();save();
}
main().catch(e=>{out.error=e.message;console.error(e.message);process.exitCode=1;});
