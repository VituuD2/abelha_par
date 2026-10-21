// Reads persisted cron/API counters only. Never invokes a worker or refreshes OAuth.
require('dotenv').config({quiet:true});
const fs=require('node:fs');
const {createClient}=require('@supabase/supabase-js');
const workspace=require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(15000)})},
});
const day=process.argv.find(a=>a.startsWith('--day='))?.slice(6)||new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Sao_Paulo'}).format(new Date());
if(!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Use --day=YYYY-MM-DD');
// São Paulo UTC-03:00 for the reviewed dates; report the exact UTC interval as well.
const start=day+'T03:00:00Z',end=day+'T09:00:00Z';
const directory='docs/evidencias/importacao-noturna-'+day;
function checked(result){if(result.error)throw Error('Read failed: '+result.error.code);return result.data||[];}
async function main(){
  const cron=checked(await db.from('analytics_cron_runs').select('requested_at').gte('requested_at',start).lt('requested_at',end).order('requested_at'));
  const minutes=[];
  for(let offset=0;;offset+=1000){
    const page=checked(await db.from('olist_api_minutes').select('minute,source,requests,responses,throttled,server_errors,timeouts,network_errors')
      .eq('workspace_id',workspace).gte('minute',start).lt('minute',end).order('minute').order('account_key').order('source').range(offset,offset+999));
    minutes.push(...page);if(page.length<1000)break;
  }
  const hours=Array.from({length:6},(_,hour)=>{
    const from=Date.parse(start)+hour*3600000,to=from+3600000;
    const rows=minutes.filter(row=>Date.parse(row.minute)>=from&&Date.parse(row.minute)<to);
    const sum=key=>rows.reduce((n,row)=>n+Number(row[key]),0);
    return {hour:hour.toString().padStart(2,'0')+':00',cronRequests:cron.filter(row=>Date.parse(row.requested_at)>=from&&Date.parse(row.requested_at)<to).length,
      apiRequests:sum('requests'),recordedResponses:sum('responses'),responses429:sum('throttled'),failures:sum('server_errors')+sum('timeouts')+sum('network_errors')};
  });
  const out={readOnly:true,checkedAt:new Date().toISOString(),timezone:'America/Sao_Paulo',day,start,end,hours,
    limitation:'Cron entries prove dispatch only; API counters prove provider attempts/results. Neither establishes whether users were logged in, nor complete import coverage.'};
  fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(directory+'/status.json',JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({directory,...out},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
