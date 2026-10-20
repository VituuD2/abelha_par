const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs');
const migration=fs.readFileSync('supabase/migration_v23_olist_api_usage.sql','utf8');
let db;const ws='11000000-0000-4000-8000-000000000001',other='11000000-0000-4000-8000-000000000002';
const ids=[1,2,3,4].map(i=>'22000000-0000-4000-8000-00000000000'+i);
const permit=n=>'33000000-0000-4000-8000-'+String(n).padStart(12,'0');
const call=async(sql,args=[]) => (await db.query(sql,args)).rows;
const acquire=async(n,connection=ids[0],source='orders',workspace=null)=>
 (await call('SELECT olist_api_acquire($1,$2,false,$3,$4) result',[permit(n),source,connection,workspace]))[0].result;
before(async()=>{
 db=new PGlite();await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE TABLE workspaces(id uuid PRIMARY KEY); CREATE TABLE workspace_members(workspace_id uuid,user_id uuid,role text,active boolean);
 CREATE TABLE analytics_companies(id uuid,workspace_id uuid,tax_id text);
 CREATE TABLE analytics_connections(id uuid,workspace_id uuid,company_id uuid,legacy_integration_id uuid,enabled boolean,name text);
 CREATE TABLE tiny_integrations(id uuid,workspace_id uuid);`);
 await db.query('INSERT INTO workspaces VALUES($1),($2)',[ws,other]);
 await db.query("INSERT INTO workspace_members VALUES($1,$1,'admin',true),($2,$2,'admin',true)",[ws,other]);
 for(const [i,tax] of ['13397731000164','36965322000112','37201039000187',null].entries()){
  await db.query('INSERT INTO analytics_companies VALUES($1,$2,$3)',[ids[i],ws,tax]);
  await db.query('INSERT INTO analytics_connections VALUES($1,$2,$1,$3,true,$4)',[ids[i],ws,i===1?ids[1]:null,'Olist '+(i+1)]);
 }
 await db.query('INSERT INTO tiny_integrations VALUES($1,$2)',[ids[1],ws]);
 await db.exec(migration);await db.exec(migration);
});
after(async()=>db.close());

test('approved account identities receive 60/36/36 and an unknown company stays conservative',async()=>{
 const values=[];for(let i=0;i<4;i++)values.push((await acquire(i+1,ids[i])).effective_limit);
 assert.deepEqual(values,[60,36,36,28]);
 const policies=await call('SELECT app_limit,plan_limit FROM olist_api_policies ORDER BY account_key');
 assert.equal(policies.length,3);
});
test('analytical, operational and concurrent workers share an account gate across instances',async()=>{
 const next=await acquire(10,null,'operational',ws);assert.equal(next.granted,false);assert.ok(next.wait_ms>0);
 await db.exec("UPDATE olist_api_state SET next_at='-infinity'");
 const results=await Promise.all([acquire(11,ids[1]),acquire(12,null,'operational',ws)]);
 assert.equal(results.filter(r=>r.granted).length,1);
 assert.equal(results.filter(r=>!r.granted).length,1);
});
test('results are idempotent and provider headers expose an account sample without inventing external attribution',async()=>{
 await db.exec("UPDATE olist_api_state SET next_at='-infinity'");await acquire(20);
 for(let i=0;i<2;i++)await call("SELECT olist_api_record($1,200,250,'http',120,80,15,null)",[permit(20)]);
 const rows=await call("SELECT requests,responses,duration_ms FROM olist_api_minutes WHERE account_key='tax:13397731000164'");
 assert.equal(rows[0].responses,1);assert.equal(Number(rows[0].duration_ms),250);
 const result=(await call('SELECT olist_api_usage($1,$1,60) result',[ws]))[0].result;
 assert.equal(result.accounts.length,4);
 const first=result.accounts.find(a=>a.connection_id===ids[0]);
 assert.equal(first.provider_limit,120);assert.equal(first.provider_remaining,80);assert.ok(first.observed_at);
 assert.equal(first.samples.length,1);assert.equal(first.samples[0].sample_count,1);
 assert.equal(JSON.stringify(result).includes('account_key'),false);
 assert.equal(JSON.stringify(result).includes('marketplace_consumption'),false);
 await assert.rejects(acquire(20),/PERMIT_ALREADY_RESERVED/);
});
test('minute history keeps the highest observed consumption sample, not a fabricated full-minute total',async()=>{
 await db.exec("UPDATE olist_api_state SET next_at='-infinity'");await acquire(25);
 await call("SELECT olist_api_record($1,200,100,'http',120,100,12,null)",[permit(25)]);
 await db.exec("UPDATE olist_api_state SET next_at='-infinity'");await acquire(26);
 await call("SELECT olist_api_record($1,200,100,'http',120,70,11,null)",[permit(26)]);
 const result=(await call('SELECT olist_api_usage($1,$1,60) result',[ws]))[0].result.accounts.find(a=>a.connection_id===ids[0]);
 assert.equal(result.samples[0].provider_remaining,70);assert.equal(result.samples[0].sample_count,3);
 assert.equal(result.provider_remaining,70);
});
test('429 pauses all callers of the account and halves its target for 15 minutes',async()=>{
 await db.exec("UPDATE olist_api_state SET next_at='-infinity'");await acquire(30,ids[1]);
 await call("SELECT olist_api_record($1,429,100,'http',60,0,50,50)",[permit(30)]);
 const result=await acquire(31,null,'operational',ws);
 assert.equal(result.granted,false);assert.equal(result.effective_limit,18);assert.ok(result.wait_ms>48000);
 const state=(await call("SELECT slow_until>now()+interval '14 minutes' reduced FROM olist_api_state WHERE account_key='tax:36965322000112'"))[0];
 assert.equal(state.reduced,true);
});
test('low remaining capacity pauses before exhaustion; a lower observed limit reduces the target',async()=>{
 await db.exec("UPDATE olist_api_state SET next_at='-infinity',cooldown_until='-infinity'");await acquire(40,ids[2]);
 await call("SELECT olist_api_record($1,200,100,'http',30,2,20,null)",[permit(40)]);
 const result=await acquire(41,ids[2]);assert.equal(result.granted,false);assert.equal(result.effective_limit,18);assert.ok(result.wait_ms>19000);
});
test('monitoring is admin scoped and storage/RPCs cannot be accessed by browser database roles',async()=>{
 const foreign=(await call('SELECT olist_api_usage($1,$1,60) result',[other]))[0].result;assert.equal(foreign.accounts.length,0);
 await assert.rejects(call('SELECT olist_api_usage($1,$2,60)',[ws,other]),/ADMIN_REQUIRED/);
 await db.exec('SET ROLE authenticated');
 try{
  await assert.rejects(call('SELECT * FROM olist_api_minutes'),/permission denied/);
  await assert.rejects(call('SELECT olist_api_usage($1,$1,60)',[ws]),/permission denied/);
  await assert.rejects(call('SELECT olist_api_acquire($1,\'orders\',false,$2,null)',[permit(50),ids[0]]),/permission denied/);
 }finally{await db.exec('RESET ROLE');}
});
test('retention is bounded and rollback removes only quota objects, allowing v23 to be reapplied',async()=>{
 await db.exec("INSERT INTO olist_api_minutes(workspace_id,account_key,minute,source,requests) SELECT workspace_id,account_key,minute-interval '3 days',source,1 FROM olist_api_minutes WHERE account_key='tax:13397731000164' LIMIT 1");
 await db.exec("UPDATE olist_api_state SET next_at='-infinity',cooldown_until='-infinity',cleanup_at='-infinity'");
 await acquire(60);
 assert.equal((await call("SELECT count(*) n FROM olist_api_minutes WHERE minute<now()-interval '48 hours'"))[0].n,0);
 await db.exec(fs.readFileSync('supabase/rollback_v23_olist_api_usage.sql','utf8'));
 assert.equal((await call("SELECT count(*) n FROM analytics_connections"))[0].n,4);
 assert.equal((await call("SELECT to_regclass('public.olist_api_minutes') t"))[0].t,null);
 await db.exec(migration);
 assert.equal((await call('SELECT olist_api_usage($1,$1,60) result',[ws]))[0].result.available,true);
});
