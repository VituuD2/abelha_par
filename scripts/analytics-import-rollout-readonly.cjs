// Observe the v24 rollout using stored metadata only. Never sends provider
// requests, reads credentials/staged payloads, schedules jobs, or claims work.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),{createClient}=require('@supabase/supabase-js');
const workspace=require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})},
});
const seconds=Number(process.argv.find(v=>v.startsWith('--observe='))?.slice(10)||0);
if(!Number.isFinite(seconds)||seconds<0||seconds>300)throw Error('Observation must be between 0 and 300 seconds');
const directory='docs/evidencias/importacao-v24-'+new Date().toISOString().replace(/\D/g,'').slice(0,14);
const output={startedAt:new Date().toISOString(),readOnly:true,snapshots:[]};
const checked=(r,label)=>{if(r.error)throw Error(label+': '+r.error.code);return r.data;};
async function snapshot(){
  const [connections,jobs,cron]=await Promise.all([
    db.from('analytics_connections').select('id,name,enabled,last_synced_at,error_code').eq('workspace_id',workspace).order('name'),
    db.from('analytics_sync_jobs').select('id,connection_id,lane,mode,status,cursor_date,query_phase,page_offset,pending_index,processed,attempts,next_at,error_code,updated_at,scan:import_state->scan,stage_id:import_state->order->>externalId')
      .eq('workspace_id',workspace).order('created_at',{ascending:false}).limit(100),
    db.from('analytics_cron_runs').select('requested_at').order('requested_at',{ascending:false}).limit(5),
  ]);
  return {at:new Date().toISOString(),connections:checked(connections,'connections'),
    jobs:checked(jobs,'jobs').map(({stage_id,...job})=>({...job,hasStage:!!stage_id})),cron:checked(cron,'cron')};
}
async function main(){
  fs.mkdirSync(directory,{recursive:true});
  output.snapshots.push(await snapshot());
  console.log(JSON.stringify({directory,at:output.snapshots[0].at,observingSeconds:seconds}));
  if(seconds){
    fs.writeFileSync(directory+'/status.json',JSON.stringify(output,null,2)+'\n');
    for(let left=seconds*1000;left>0;left-=30000)await new Promise(r=>setTimeout(r,Math.min(30000,left)));
    output.snapshots.push(await snapshot());
    const [before,after]=output.snapshots;
    output.progress=after.connections.map(c=>({name:c.name,errorCode:c.error_code,lastSyncedAt:c.last_synced_at,
      processedDelta:after.jobs.filter(j=>j.connection_id===c.id).reduce((n,j)=>n+j.processed-(before.jobs.find(p=>p.id===j.id)?.processed||0),0),
      recentJobs:after.jobs.filter(j=>j.connection_id===c.id&&j.lane==='recent').length,
      active:after.jobs.filter(j=>j.connection_id===c.id&&j.status!=='completed').map(j=>({lane:j.lane,mode:j.mode,status:j.status,
        queryPhase:j.query_phase,scan:j.scan,hasStage:j.hasStage}))}));
  }
}
main().catch(e=>{output.error=e.message;process.exitCode=1;}).finally(()=>{
  fs.mkdirSync(directory,{recursive:true});output.finishedAt=new Date().toISOString();
  fs.writeFileSync(directory+'/status.json',JSON.stringify(output,null,2)+'\n');
  console.log(JSON.stringify({directory,error:output.error,progress:output.progress,
    latest:output.snapshots.at(-1)?.jobs.filter(j=>j.status!=='completed').map(j=>({lane:j.lane,mode:j.mode,status:j.status,version:j.scan?.version,hasStage:j.hasStage}))}));
});
