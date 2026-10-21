require('./setup.cjs');
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict'),{readFileSync}=require('node:fs');
const {isolatedDatabase,ws,connections}=require('../scripts/analytics-isolated.cjs');
const migration=readFileSync('supabase/migration_v24_analytics_resumable_import.sql','utf8');
let db,legacy;
const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
async function expectError(action,pattern){
  await db.exec('SAVEPOINT expected_error');
  await assert.rejects(action,pattern);
  await db.exec('ROLLBACK TO SAVEPOINT expected_error; RELEASE SAVEPOINT expected_error');
}
before(async()=>{
  db=await isolatedDatabase();
  for(const file of ['migration_v14_v15_analytics_complete.sql','migration_v16_analytics_confirmed_unlinked.sql','migration_v18_analytics_olist_costs.sql','migration_v19_analytics_cost_effective_dates.sql'])
    await db.exec(readFileSync('supabase/'+file,'utf8'));
  await db.exec(readFileSync('supabase/migration_v23_olist_api_usage.sql','utf8'));
  [legacy]=await query(`INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,
    pending_ids,pending_index,page_offset,processed,query_phase,covers_sales)
    VALUES($1,$2,'incremental','2026-10-01','2026-10-19','2026-10-03','["91","92"]',1,1700,8714,'updates',true) RETURNING *`,[ws,connections[0]]);
  await db.exec(migration);await db.exec(migration);
});
beforeEach(async()=>db.exec('BEGIN'));
afterEach(async()=>db.exec('ROLLBACK'));
after(async()=>db?.close());

test('v24 is repeatable and preserves every existing cursor, pending ID, index and processed counter',async()=>{
  const [row]=await query('SELECT * FROM analytics_sync_jobs WHERE id=$1',[legacy.id]);
  for(const key of ['cursor_date','pending_ids','pending_index','page_offset','processed','query_phase','covers_sales'])assert.deepEqual(row[key],legacy[key]);
  assert.equal(row.lane,'history');assert.deepEqual(row.import_state,{});
});

test('recent scheduling is idempotent and independent of a long-running incremental, without blocking old history',async()=>{
  await db.exec('UPDATE analytics_connections SET last_synced_at=now()');
  assert.equal((await query('SELECT analytics_schedule_recent() n'))[0].n,3);
  assert.equal((await query('SELECT analytics_schedule_recent() n'))[0].n,0);
  const rows=await query("SELECT * FROM analytics_sync_jobs WHERE lane='recent'");
  assert.equal(rows.length,3);assert.ok(rows.every(j=>+j.cursor_date===+j.to_date&&j.from_date<j.to_date));
  assert.equal((await query('SELECT count(*) n FROM analytics_sync_jobs WHERE id=$1',[legacy.id]))[0].n,1);
});

test('one account alternates eligible recent work with its older incremental under the original lease',async()=>{
  await db.query('UPDATE analytics_connections SET enabled=(id=$1),last_synced_at=now()',[connections[0]]);
  await db.exec('SELECT analytics_schedule_recent()');
  const [first]=await query('SELECT * FROM analytics_claim_job($1)',[ws]);assert.equal(first.lane,'recent');
  assert.equal((await query('SELECT * FROM analytics_claim_job($1)',[ws])).length,0);
  await db.exec("UPDATE analytics_connections SET sync_lock=null,sync_locked_until=null; UPDATE analytics_sync_jobs SET lease_token=null,lease_until=null,status='queued'");
  const [second]=await query('SELECT * FROM analytics_claim_job($1)',[ws]);assert.equal(second.id,legacy.id);
});

test('parallel reservation still returns distinct accounts, capped at three',async()=>{
  await db.exec('UPDATE analytics_connections SET last_synced_at=now(); SELECT analytics_schedule_recent()');
  const rows=await query('SELECT * FROM analytics_claim_jobs($1,3)',[ws]);
  assert.equal(rows.length,3);assert.equal(new Set(rows.map(j=>j.connection_id)).size,3);
});

test('import context is lease-scoped and includes the earliest requested history rather than just the recent window',async()=>{
  await db.query(`INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,status)
    VALUES($1,$2,'backfill','2026-07-23','2026-07-31','2026-07-31','completed')`,[ws,connections[0]]);
  const [job]=await query('SELECT * FROM analytics_claim_job($1)',[ws]);
  const ctx=(await query('SELECT analytics_import_context($1,$2) result',[job.id,job.lease_token]))[0].result;
  assert.equal(ctx.historyFrom,'2026-07-23');assert.equal(ctx.connectionVersion,1);
  await expectError(()=>db.query('SELECT analytics_import_context($1,$2)',[job.id,'99000000-0000-4000-8000-000000000001']),/LEASE_CHANGED/);
});

async function readyToFinish(){
  const [job]=await query('SELECT * FROM analytics_claim_job($1)',[ws]);
  await db.query(`UPDATE analytics_sync_jobs SET page_done=true,pending_index=2,cursor_date=to_date,
    import_state=jsonb_build_object('scan',jsonb_build_object('version',2,'to',to_date,'ceiling',to_date)) WHERE id=$1`,[job.id]);
  return job;
}

test('completion and incremental watermark commit atomically, removing the temporary order snapshot',async()=>{
  const job=await readyToFinish();
  await db.query('SELECT analytics_finish_import($1,$2)',[job.id,job.lease_token]);
  const [finished]=await query('SELECT * FROM analytics_sync_jobs WHERE id=$1',[job.id]);
  const [connection]=await query('SELECT * FROM analytics_connections WHERE id=$1',[job.connection_id]);
  assert.equal(finished.status,'completed');assert.equal(finished.lease_token,null);
  assert.deepEqual(connection.incremental_through,finished.to_date);
});

test('a missing account lease rolls back completion and leaves its checkpoint and watermark intact',async()=>{
  const job=await readyToFinish();
  await db.query('UPDATE analytics_connections SET sync_lock=null WHERE id=$1',[job.connection_id]);
  await expectError(()=>db.query('SELECT analytics_finish_import($1,$2)',[job.id,job.lease_token]),/LEASE_CHANGED/);
  assert.equal((await query('SELECT status FROM analytics_sync_jobs WHERE id=$1',[job.id]))[0].status,'running');
  assert.equal((await query('SELECT incremental_through FROM analytics_connections WHERE id=$1',[job.connection_id]))[0].incremental_through,null);
});

test('partial sales, unfinished update partitions and incomplete pending IDs cannot mark coverage complete',async()=>{
  const job=await readyToFinish();
  for(const patch of ["pending_index=0","query_phase='sales'","import_state='{\"scan\":{\"to\":\"2026-10-01\",\"ceiling\":\"2026-10-19\"}}'"]){
    await db.exec('SAVEPOINT partial');await db.exec('UPDATE analytics_sync_jobs SET '+patch);
    await expectError(()=>db.query('SELECT analytics_finish_import($1,$2)',[job.id,job.lease_token]),/IMPORT_NOT_COMPLETE/);
    await db.exec('ROLLBACK TO SAVEPOINT partial; RELEASE SAVEPOINT partial');
  }
});

test('new context, completion and scheduling functions are restricted to the server role',async()=>{
  for(const signature of ['analytics_import_context(uuid,uuid)','analytics_finish_import(uuid,uuid)','analytics_schedule_recent()',
    'analytics_defer_cost(uuid,uuid,uuid,integer,text,integer,text)']){
    for(const role of ['anon','authenticated','service_role']){
      const [r]=await query('SELECT has_function_privilege($1,$2,\'EXECUTE\') ok',[role,signature]);
      assert.equal(r.ok,role==='service_role');
    }
  }
});

test('cost quota waits defer catalog or history without incrementing attempts or changing offsets',async()=>{
  const connection=connections[0];
  await db.query("UPDATE analytics_companies SET tax_id='13397731000164' WHERE id=$1",[connection]);
  await db.exec('SELECT analytics_seed_cost_sources()');
  const lease='88000000-0000-4000-8000-000000000001';
  const [conn]=await query('SELECT version FROM analytics_connections WHERE id=$1',[connection]);
  await db.query("UPDATE analytics_connections SET sync_lock=$2,sync_locked_until=now()+interval '90 seconds' WHERE id=$1",[connection,lease]);
  await db.query('UPDATE analytics_cost_sync SET page_offset=100,attempts=7 WHERE connection_id=$1',[connection]);
  await db.query("SELECT analytics_defer_cost($1,$2,$3,$4,'catalog',30)",[ws,connection,lease,conn.version]);
  const [catalog]=await query('SELECT page_offset,attempts,last_error,next_at>now() deferred FROM analytics_cost_sync WHERE connection_id=$1',[connection]);
  assert.deepEqual(catalog,{page_offset:100,attempts:7,last_error:null,deferred:true});
  await db.query("UPDATE analytics_connections SET sync_lock=$2,sync_locked_until=now()+interval '90 seconds' WHERE id=$1",[connection,lease]);
  await db.query(`INSERT INTO analytics_product_costs(workspace_id,connection_id,external_id,sku,active,scan_id)
    VALUES($1,$2,'10','SKU',true,gen_random_uuid())`,[ws,connection]);
  await db.query(`INSERT INTO analytics_cost_history_sync(workspace_id,connection_id,external_id,sku,provider_revision,page_offset,attempts)
    VALUES($1,$2,'10','SKU','revision',100,9)`,[ws,connection]);
  await db.query("SELECT analytics_defer_cost($1,$2,$3,$4,'history',30,'10')",[ws,connection,lease,conn.version]);
  const [history]=await query('SELECT page_offset,attempts,last_error,next_at>now() deferred FROM analytics_cost_history_sync WHERE connection_id=$1',[connection]);
  assert.deepEqual(history,{page_offset:100,attempts:9,last_error:null,deferred:true});
});
