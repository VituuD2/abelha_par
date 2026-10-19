// Read-only observation of existing jobs. Does not call ERP, refresh tokens or run workers.
require('dotenv').config({quiet:true});
const fs=require('node:fs');
const {createClient}=require('@supabase/supabase-js');
const catalog=require('../src/lib/analytics/data/composition-catalog.json');
const workspace=catalog.workspaceIds[0];
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(20000)})},
});
const directory=`docs/evidencias/importacao-ritmo-${new Date().toISOString().replace(/\D/g,'').slice(0,14)}`;
const result={startedAt:new Date().toISOString(),readOnly:true,timezone:'America/Sao_Paulo',snapshots:[]};
const checked=(r,label)=>{if(r.error)throw Error(`${label}: ${r.error.code}`);return r.data;};
async function snapshot(){
  const at=new Date().toISOString();
  const [connections,jobs,cron,member]=await Promise.all([
    db.from('analytics_connections').select('id,name,enabled,verified_at,last_synced_at,last_processed_at,incremental_through,sync_locked_until,last_error,error_code').eq('workspace_id',workspace).order('name'),
    db.from('analytics_sync_jobs').select('id,connection_id,mode,status,from_date,to_date,cursor_date,query_phase,page_offset,pending_ids,pending_index,processed,pages,attempts,next_at,created_at,updated_at,last_claimed_at,lease_until,error_code,last_error,covers_sales').eq('workspace_id',workspace).order('created_at').limit(1000),
    db.from('analytics_cron_runs').select('requested_at').order('requested_at',{ascending:false}).limit(15),
    db.from('workspace_members').select('user_id').eq('workspace_id',workspace).eq('active',true).eq('role','admin').limit(1),
  ]);
  const conns=checked(connections,'connections'), actor=checked(member,'member')[0]?.user_id;
  if(!actor)throw Error('Active member required');
  const coverage=checked(await db.rpc('analytics_coverage',{p_workspace:workspace,p_actor:actor},{get:true}),'coverage');
  const summaries=await Promise.all(conns.map(async c=>{
    const [count,first,last]=await Promise.all([
      db.from('analytics_orders').select('*',{head:true,count:'exact'}).eq('workspace_id',workspace).eq('connection_id',c.id),
      db.from('analytics_orders').select('sale_date').eq('workspace_id',workspace).eq('connection_id',c.id).order('sale_date').limit(1),
      db.from('analytics_orders').select('sale_date').eq('workspace_id',workspace).eq('connection_id',c.id).order('sale_date',{ascending:false}).limit(1),
    ]);
    checked(count,'count');return {...c,orders:count.count,firstSale:checked(first,'first')[0]?.sale_date,lastSale:checked(last,'last')[0]?.sale_date};
  }));
  return {at,finishedAt:new Date().toISOString(),connections:summaries,coverage,
    jobs:checked(jobs,'jobs').map(({pending_ids,...job})=>({...job,pendingCount:pending_ids.length})),cron:checked(cron,'cron')};
}
function save(){fs.writeFileSync(directory+'/status.json',JSON.stringify(result,null,2)+'\n');}
async function main(){
  fs.mkdirSync(directory,{recursive:true});
  const observe=Number(process.argv.find(a=>a.startsWith('--observe='))?.split('=')[1]||'0');
  if(!Number.isFinite(observe)||observe<0||observe>300)throw Error('Invalid observation window');
  for(const seconds of observe?[0,observe]:[0]){
    if(seconds)for(let remaining=seconds*1000;remaining>0;remaining-=30000)await new Promise(r=>setTimeout(r,Math.min(30000,remaining)));
    const s=await snapshot();result.snapshots.push(s);save();
    console.log(JSON.stringify({directory,at:s.at,connections:s.connections,jobs:s.jobs,coverage:s.coverage,cron:s.cron.slice(0,3)}));
  }
  if(result.snapshots.length===2){
    const [a,b]=result.snapshots,minutes=(Date.parse(b.at)-Date.parse(a.at))/60000;
    result.progress=b.connections.map(c=>{
      const previous=a.connections.find(p=>p.id===c.id);
      const processedDelta=b.jobs.filter(j=>j.connection_id===c.id).reduce((n,j)=>n+j.processed-(a.jobs.find(p=>p.id===j.id)?.processed||0),0);
      return {company:c.name,minutes,newRows:c.orders-previous.orders,processedDelta,eventsPerMinute:processedDelta/minutes,newRowsPerMinute:(c.orders-previous.orders)/minutes};
    });
  }
  result.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({directory,progress:result.progress}));
}
main().catch(e=>{result.error=e.message;save();console.error(JSON.stringify({directory,error:e.message}));process.exitCode=1;});
