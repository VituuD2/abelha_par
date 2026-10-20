// Reads stored API usage only. Never calls Olist, claims work, refreshes tokens or modifies production.
require('dotenv').config({quiet:true});
const fs=require('node:fs'),{createClient}=require('@supabase/supabase-js');
const workspace=require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
 auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(10000)})},
});
const directory='docs/evidencias/olist-consumo-'+new Date().toISOString().replace(/\D/g,'').slice(0,14);
const out={at:new Date().toISOString(),readOnly:true};
async function main(){
 const member=await db.from('workspace_members').select('user_id').eq('workspace_id',workspace).eq('role','admin').eq('active',true).limit(1);
 if(member.error||!member.data?.[0])throw Error('Active administrator required');
 const result=await db.rpc('olist_api_usage',{p_workspace:workspace,p_actor:member.data[0].user_id,p_minutes:60},{get:true});
 if(result.error){out.available=false;out.status=result.status;out.code=result.error.code;out.message=['PGRST202','42883'].includes(result.error.code)?'Apply migration_v23_olist_api_usage.sql before monitoring.':'Usage read unavailable.';return;}
 out.available=true;out.usage=result.data;
}
main().catch(e=>{out.error=e.message;process.exitCode=1;}).finally(()=>{
 fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(directory+'/usage.json',JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({directory,at:out.at,available:out.available,code:out.code,message:out.message,error:out.error,
  accounts:out.usage?.accounts?.map(a=>({name:a.name,plan:a.plan,appLimit:a.app_limit,effectiveLimit:a.effective_limit,
   calls:a.minutes.reduce((n,m)=>n+m.requests,0),responses429:a.minutes.reduce((n,m)=>n+m.throttled,0),remaining:a.provider_remaining,observedAt:a.observed_at}))}));
});
