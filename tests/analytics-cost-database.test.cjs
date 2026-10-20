require('./setup.cjs');
const {test,before,after}=require('node:test'),assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {isolatedDatabase,ws,connections,filters}=require('../scripts/analytics-isolated.cjs');
const catalog=require('../src/lib/analytics/data/composition-catalog.json');
const {compositionRulesForWorkspace}=require('../src/lib/analytics/composition-server.ts');
const {exportMetadata}=require('../src/lib/analytics/export.ts');
const rules={...compositionRulesForWorkspace(catalog.workspaceIds[0]),referenceCosts:{'ACFS000-K001':'99999','ACTM000-K010':'11111'}};
const f={...filters,grouping:'composition'};
let db;
before(async()=>{
 db=await isolatedDatabase();
 for(const file of ['migration_v14_v15_analytics_complete.sql','migration_v16_analytics_confirmed_unlinked.sql','migration_v18_analytics_olist_costs.sql','migration_v18_analytics_olist_costs.sql'])
  await db.exec(readFileSync(`supabase/${file}`,'utf8'));
 await db.query("UPDATE analytics_companies SET tax_id='13397731000164' WHERE id=$1",[connections[0]]);
 await db.query('SELECT analytics_seed_cost_sources()');
 const source=(await db.query('SELECT * FROM analytics_cost_sync')).rows;
 assert.equal(source.length,1);assert.equal(source[0].connection_id,connections[0]);
 const order=(await db.query(`INSERT INTO analytics_orders(workspace_id,company_id,connection_id,source_id,canonical_key,external_id,customer_key,customer_name,sale_date,status,total_cents,fetched_at)
  VALUES($1,$2,$2,$2,'cost-test','500','client','Cliente','2026-09-10',1,10001,now()) RETURNING id`,[ws,connections[2]])).rows[0].id;
 await db.query(`INSERT INTO analytics_products(workspace_id,connection_id,external_id,sku,name) VALUES($1,$2,'1','ACTM011-K011','Kit')`,[ws,connections[2]]);
 await db.query(`INSERT INTO analytics_items(workspace_id,order_id,position,connection_id,product_id,quantity,unit_price,gross_cents) VALUES($1,$2,0,$3,'1',1,100.01,10001)`,[ws,order,connections[2]]);
});
after(async()=>{await db?.close();});
const product=(external_id,sku,cost_cents,active=true)=>({external_id,sku,cost_cents,active});
const complete=[product('10','ACFS000-K001','100.0000'),product('11','ACTM000-K010','300.0000')];
async function claim(){return(await db.query('SELECT analytics_claim_cost_sync() job')).rows[0].job;}
async function finish(job,products=complete,done=true,error=null){
 return db.query('SELECT analytics_finish_cost_page($1,$2,$3,$4,$5,$6,$7,$8,123)',[ws,job.connection_id,job.lease,job.connection_version,job.page_offset,JSON.stringify(products),done,error]);
}
async function refresh(products=complete,done=true){
 await db.query('UPDATE analytics_connections SET sync_locked_until=null WHERE id=$1',[connections[0]]);
 await db.query('UPDATE analytics_cost_sync SET next_at=now() WHERE workspace_id=$1',[ws]);
 const job=await claim();assert.ok(job);await finish(job,products,done);return job;
}
async function report(metric='revenue',actor=ws){
 return(await db.query('SELECT analytics_abc_components_v18($1,$2,$3,$4) result',[ws,actor,JSON.stringify({...f,metric}),JSON.stringify(rules)])).rows[0].result;
}
async function fixture(fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
async function reject(fn,pattern){await db.exec('SAVEPOINT expected_error');await assert.rejects(fn,pattern);await db.exec('ROLLBACK TO SAVEPOINT expected_error');}

test('September 1–30 report recovers ACFS000-K001 from Olist 1 for sales in Olist 3, with exact cent conservation',()=>fixture(async()=>{
 await reject(()=>report(),/CMV_REQUIRED:.*ACFS000-K001/);
 const quantity=await report('quantity');assert.equal(Number(quantity.quantity),2);assert.equal(quantity.composition.unallocatedRevenue,'10001');
 await refresh();
 const result=await report();assert.equal(result.revenue,'10001');assert.equal(result.orders,1);
 assert.equal(result.rows.find(p=>p.sku==='ACFS000-K001').revenue,'2500');
 assert.equal(result.rows.find(p=>p.sku==='ACTM000-K010').revenue,'7501');
 assert.equal(result.composition.costSource.kind,'olist');assert.equal(result.composition.costSource.connectionId,connections[0]);
 assert.equal(result.composition.missingCostSkus.length,0);
 const drill=(await db.query('SELECT analytics_drilldown_components_v18($1,$2,$3,$4,$5) result',[ws,ws,JSON.stringify(f),JSON.stringify(rules),'composition:ACFS000-K001'])).rows[0].result;
 assert.equal(drill.sources[0].referenceCostCents,'100.0000');assert.equal(drill.sources[0].revenue,'2500');
 assert.ok(exportMetadata(f,result).some(([key,value])=>key.endsWith('fonte do CMV')&&value.includes('precos.precoCusto')));
 assert.equal(await claim(),null); // Fresh cache does not query the provider again.
}));

test('changes update allocations without editing the catalog; repeated costs do not bloat audit history',()=>fixture(async()=>{
 await refresh();assert.equal((await db.query('SELECT count(*) n FROM analytics_product_cost_history')).rows[0].n,2);
 await refresh();assert.equal((await db.query('SELECT count(*) n FROM analytics_product_cost_history')).rows[0].n,2);
 await refresh([product('10','ACFS000-K001','300.0000'),complete[1]]);
 const result=await report();assert.equal(result.rows.find(p=>p.sku==='ACFS000-K001').revenue,'5001');
 assert.equal((await db.query('SELECT count(*) n FROM analytics_product_cost_history')).rows[0].n,3);
 await refresh([product('10','ACFS000-K001','0.1250'),product('11','ACTM000-K010','0.3750')]);
 assert.equal((await report()).rows.find(p=>p.sku==='ACFS000-K001').revenue,'2500');
}));

test('zero, missing, deleted or ambiguous Olist costs never fall back to inline costs',()=>fixture(async()=>{
 for(const products of [
  [product('10','ACFS000-K001','0'),complete[1]],
  [product('10','ACFS000-K001',null),complete[1]],
  [product('10','ACFS000-K001','100',false),complete[1]],
  [...complete,product('12','ACFS000-K001','900')],
 ]){
  await refresh(products);await reject(()=>report(),/CMV_REQUIRED:ACFS000-K001/);
  assert.equal(Number((await report('quantity')).quantity),2);
 }
 await refresh([complete[1],product('20',null,'200',false)]);await reject(()=>report(),/CMV_REQUIRED:ACFS000-K001/);
 const inactive=(await db.query("SELECT active FROM analytics_product_costs WHERE external_id='10'")).rows[0];assert.equal(inactive.active,false);
 const foreign=(await db.query('SELECT analytics_olist_cost_rules($1,$2) rules',['ffffffff-ffff-4fff-8fff-ffffffffffff',JSON.stringify(rules)])).rows[0].rules;
 assert.deepEqual(foreign.referenceCosts,{});
}));

test('pagination, retry and audit commit together; imported pages survive a failed next request',()=>fixture(async()=>{
 const first=await claim();await finish(first,[complete[0]],false);
 let state=(await db.query('SELECT * FROM analytics_cost_sync')).rows[0];assert.equal(state.page_offset,1);assert.equal(state.last_synced_at,null);
 await db.query('UPDATE analytics_connections SET sync_locked_until=null WHERE id=$1',[connections[0]]);
 const second=await claim();await finish(second,[],false,'429 retry');
 state=(await db.query('SELECT * FROM analytics_cost_sync')).rows[0];assert.equal(state.page_offset,1);assert.equal(state.last_error,'429 retry');
 assert.equal((await db.query('SELECT count(*) n FROM analytics_product_costs')).rows[0].n,1);
 await refresh([complete[1]]);assert.equal((await report()).revenue,'10001');
}));

test('costs and sales share the distributed account lease; stale version and worker cannot commit',()=>fixture(async()=>{
 const first=await claim();assert.ok(first);assert.equal(await claim(),null);
 assert.equal((await db.query('SELECT * FROM analytics_claim_job($1)',[ws])).rows.length,0);
 await reject(()=>finish({...first,lease:'ffffffff-ffff-4fff-8fff-ffffffffffff'}),/COST_LEASE_CHANGED/);
 await db.query('UPDATE analytics_connections SET version=version+1 WHERE id=$1',[connections[0]]);
 await reject(()=>finish(first),/COST_LEASE_CHANGED/);
 assert.equal((await db.query('SELECT count(*) n FROM analytics_product_costs')).rows[0].n,0);
}));

test('new cost storage and workers are inaccessible to browser roles, and reports still enforce membership',()=>fixture(async()=>{
 const storage=(await db.query(`SELECT tablename,rowsecurity FROM pg_tables WHERE tablename IN ('analytics_cost_sync','analytics_product_costs','analytics_product_cost_history')`)).rows;
 assert.equal(storage.length,3);assert.ok(storage.every(t=>t.rowsecurity));
 for(const role of ['anon','authenticated']){
  const permissions=(await db.query(`SELECT has_table_privilege($1,'analytics_product_costs','select') read,has_function_privilege($1,'analytics_claim_cost_sync()','execute') claim,has_function_privilege($1,'analytics_olist_cost_rules(uuid,jsonb)','execute') costs`,[role])).rows[0];
  assert.deepEqual(permissions,{read:false,claim:false,costs:false});
 }
 await reject(()=>report('quantity','ffffffff-ffff-4fff-8fff-ffffffffffff'),/MEMBER_REQUIRED/);
}));
