// One GET /info per connected company. Does not refresh OAuth, run workers or write production data.
require('../tests/setup.cjs');require('dotenv').config({quiet:true});
const fs=require('node:fs'),{createClient}=require('@supabase/supabase-js');
const {decryptToken}=require('../src/lib/token-crypto.ts');
const workspace=require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const directory='docs/evidencias/olist-cotas-'+new Date().toISOString().replace(/\D/g,'').slice(0,14);
const out={at:new Date().toISOString(),readOnly:true,accounts:[]};
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
 auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(u,o)=>fetch(u,{...o,signal:AbortSignal.timeout(10000)})},
});
const checked=r=>{if(r.error)throw Error('Database read '+r.status+'/'+r.error.code);return r.data;};
async function main(){
 const companies=checked(await db.from('analytics_companies').select('id,tax_id').eq('workspace_id',workspace));
 const connections=checked(await db.from('analytics_connections').select('id,name,company_id,credential_kind,legacy_integration_id,access_token,expires_at').eq('workspace_id',workspace).eq('enabled',true).order('name'));
 for(const c of connections){
  const sample={name:c.name,at:new Date().toISOString()};out.accounts.push(sample);
  try{
   const stored=c.credential_kind==='legacy'?checked(await db.from('tiny_integrations').select('access_token,expires_at').eq('workspace_id',workspace).eq('id',c.legacy_integration_id).single()):c;
   if(!stored.access_token||!(Date.parse(stored.expires_at||'')>Date.now())){sample.error='Stored token unavailable/expired; no refresh attempted.';continue;}
   const response=await fetch('https://api.tiny.com.br/public-api/v3/info',{headers:{Authorization:'Bearer '+decryptToken(stored.access_token)},signal:AbortSignal.timeout(10000)});
   sample.httpStatus=response.status;
   for(const [key,header] of [['limit','x-ratelimit-limit'],['remaining','x-ratelimit-remaining'],['resetSeconds','x-ratelimit-reset']]){
    const raw=response.headers.get(header);sample[key]=raw&&/^\d+$/.test(raw)?Number(raw):null;
   }
   if(response.ok){const body=await response.json();sample.identityMatches=String(body.cpfCnpj).replace(/\D/g,'')===companies.find(co=>co.id===c.company_id)?.tax_id;}
   sample.usedObserved=sample.limit!==null&&sample.remaining!==null?sample.limit-sample.remaining:null;
  }catch{sample.error='GET unavailable; no retry attempted.';}
 }
}
main().catch(e=>{out.error=e.message;process.exitCode=1;}).finally(()=>{
 fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(directory+'/headers.json',JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify({directory,...out}));
});
