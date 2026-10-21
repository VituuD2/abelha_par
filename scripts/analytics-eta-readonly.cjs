// Counts the exact filters the worker still needs to traverse. GET only; no OAuth refresh or queue writes.
require('../tests/setup.cjs');require('dotenv').config({quiet:true});
const fs=require('node:fs'),{createClient}=require('@supabase/supabase-js');
const {decryptToken}=require('../src/lib/token-crypto.ts');
const workspace=require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(15000)})}});
const dir='docs/evidencias/importacao-estimativa-'+new Date().toISOString().replace(/\D/g,'').slice(0,14);
const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
const only=process.argv.find(arg=>arg.startsWith('--connection='))?.slice(13);
const sampled=process.argv.includes('--sample');
const out={startedAt:new Date().toISOString(),readOnly:true,today,accounts:[]};
const checked=r=>{if(r.error)throw Error('Database '+r.error.code);return r.data;};
const tomorrow=d=>new Date(Date.parse(d+'T12:00:00Z')+86400000).toISOString().slice(0,10);
function save(){fs.writeFileSync(dir+'/counts.json',JSON.stringify(out,null,2)+'\n');}
async function main(){
 fs.mkdirSync(dir,{recursive:true});
 const connections=checked(await db.from('analytics_connections').select('id,name,credential_kind,legacy_integration_id,access_token,expires_at,verified_tax_id').eq('workspace_id',workspace).eq('enabled',true).order('name'));
 const jobs=checked(await db.from('analytics_sync_jobs').select('id,connection_id,mode,status,from_date,to_date,cursor_date,query_phase,page_offset,pending_index,processed,updated_at').eq('workspace_id',workspace).neq('status','completed'));
 await Promise.all(connections.filter(c=>!only||c.id===only).map(async c=>{
  const entry={name:c.name,connectionId:c.id,queries:[]};out.accounts.push(entry);
  try{
   const job=jobs.find(j=>j.connection_id===c.id&&j.mode==='incremental');
   if(!job)throw Error('No active incremental');entry.job=job;
   const stored=c.credential_kind==='legacy'?checked(await db.from('tiny_integrations').select('access_token,expires_at').eq('workspace_id',workspace).eq('id',c.legacy_integration_id).single()):c;
   if(!stored?.access_token||Date.parse(stored.expires_at)<=Date.now())throw Error('Expired token; no refresh performed');
   const token=decryptToken(stored.access_token);let previous=0;
   async function get(params){
    await new Promise(r=>setTimeout(r,Math.max(0,previous+5000-Date.now())));previous=Date.now();
    const r=await fetch('https://api.tiny.com.br/public-api/v3'+params,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)});
    if(!r.ok){await r.body?.cancel();throw Error('Olist HTTP '+r.status+'; audit stopped for this account');}
    const body=await r.json();
    const remaining=r.headers.get('x-ratelimit-remaining');
    if(remaining!==null&&Number(remaining)<=10)throw Error('Low remaining provider quota; audit stopped');
    return body;
   }
   if(String((await get('/info')).cpfCnpj).replace(/\D/g,'')!==c.verified_tax_id)throw Error('Identity mismatch');
   async function count(kind,from,to){
    const params={limit:'1',offset:'0',orderBy:'asc',...(kind==='updates'?{dataAtualizacao:from}:{dataInicial:from,dataFinal:to})};
    const body=await get('/pedidos?'+new URLSearchParams(params));
    const total=Number(body.paginacao?.total);if(!Number.isSafeInteger(total)||total<0)throw Error('Invalid source total');
    const row={kind,from,to:kind==='updates'?null:to,total,observedAt:new Date().toISOString()};entry.queries.push(row);save();return total;
   }
   // A daily update query is counted independently: its results may overlap previous days.
   if(sampled){
    entry.sampled=true;
    const middle=new Date((Date.parse(job.cursor_date+'T12:00:00Z')+Date.parse(today+'T12:00:00Z'))/2).toISOString().slice(0,10);
    for(const day of [...new Set([job.cursor_date,middle,job.to_date,today])].sort())await count('updates',day);
   }else for(let day=job.cursor_date;day<=today;day=tomorrow(day))await count('updates',day);
   if(job.cursor_date<job.to_date)await count('sales',tomorrow(job.cursor_date),job.to_date);
   // After the active job, current scheduling overlaps two days and catches up through today.
   const followFrom=new Date(Date.parse(job.to_date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
   entry.followUpFrom=followFrom;
   await count('sales',followFrom,today);
   await count('sales',today,today);
   entry.complete=!sampled;entry.sampleComplete=sampled;
  }catch(e){entry.error=e.name==='TimeoutError'?'Source timeout; no further calls for this account':e.message;}
  save();console.log(JSON.stringify({directory:dir,...entry}));
 }));
 out.finishedAt=new Date().toISOString();save();
}
main().catch(e=>{out.error=e.message;console.error(e.message);process.exitCode=1;});
