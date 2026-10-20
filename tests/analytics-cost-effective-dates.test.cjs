require('./setup.cjs');
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs');
const {isolatedDatabase,ws,connections,filters}=require('../scripts/analytics-isolated.cjs');
const {compositionRulesForWorkspace}=require('../src/lib/analytics/composition-server.ts');
const catalog=require('../src/lib/analytics/data/composition-catalog.json');
const {normalizeCostHistoryPage}=require('../src/lib/analytics/cost-history-sync.ts');
const rules={...compositionRulesForWorkspace(catalog.workspaceIds[0]),referenceCosts:{'ACFS000-K001':'999999','ACTM000-K010':'1'}};
const f={...filters,grouping:'composition',costBasis:'average'};
const skus=['ACFS000-K001','ACTM000-K010'];let db;
before(async()=>{
 db=await isolatedDatabase();
 for(const file of ['migration_v14_v15_analytics_complete.sql','migration_v16_analytics_confirmed_unlinked.sql','migration_v18_analytics_olist_costs.sql','migration_v19_analytics_cost_effective_dates.sql','migration_v19_analytics_cost_effective_dates.sql'])await db.exec(readFileSync(`supabase/${file}`,'utf8'));
 await db.query("UPDATE analytics_companies SET tax_id='13397731000164' WHERE id=$1",[connections[0]]);
 await db.query('SELECT analytics_seed_cost_sources()');
 for(const [i,sku] of skus.entries())await db.query(`INSERT INTO analytics_product_costs(workspace_id,connection_id,external_id,sku,cost_cents,active,scan_id,provider_revision) VALUES($1,$2,$3,$4,999999,true,gen_random_uuid(),'v1')`,[ws,connections[0],String(i+10),sku]);
 await db.query('SELECT analytics_queue_cost_history($1,$2)',[ws,skus]);
 for(const [i,date]of ['2026-09-10','2026-09-20'].entries()){
  const order=(await db.query(`INSERT INTO analytics_orders(workspace_id,company_id,connection_id,source_id,canonical_key,external_id,customer_key,customer_name,sale_date,invoice_date,invoice_eligible,status,total_cents,fetched_at)
    VALUES($1,$2,$2,$2,$3,$3,'customer','Cliente',$4,'2026-09-20',true,1,10001,now()) RETURNING id`,[ws,connections[2],String(500+i),date])).rows[0].id;
  await db.query(`INSERT INTO analytics_products(workspace_id,connection_id,external_id,sku,name) VALUES($1,$2,'1','ACTM011-K011','Kit') ON CONFLICT DO NOTHING`,[ws,connections[2]]);
  await db.query(`INSERT INTO analytics_items(workspace_id,order_id,position,connection_id,product_id,quantity,unit_price,gross_cents) VALUES($1,$2,0,$3,'1',1,100.01,10001)`,[ws,order,connections[2]]);
 }
});
after(async()=>{await db?.close();});
const ev=(data,precoCusto,custoMedio)=>({data,precoCusto,custoMedio});
const histories={10:[ev('2026-08-01',1,2),ev('2026-09-15',3,4)],11:[ev('2026-08-01',3,6)]};
async function fixture(fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
async function reject(fn,pattern){await db.exec('SAVEPOINT expected_error');await assert.rejects(fn,pattern);await db.exec('ROLLBACK TO SAVEPOINT expected_error');}
async function claim(force=true){
 await db.query('UPDATE analytics_connections SET sync_locked_until=null WHERE id=$1',[connections[0]]);
 if(force)await db.query('SELECT analytics_queue_cost_history($1,$2,true)',[ws,skus]);
 return(await db.query('SELECT analytics_claim_cost_history() batch')).rows[0].batch;
}
async function finish(batch,job,values,done=true,error=null){
 const page=normalizeCostHistoryPage({itens:values},job.page_offset);
 return db.query('SELECT analytics_finish_cost_history_page($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[ws,batch.connection_id,batch.lease,batch.connection_version,job.external_id,job.scan_id,job.page_offset,page.count,JSON.stringify(page.events),done,error]);
}
async function publish(values=histories){
 const batch=await claim();assert.ok(batch);
 for(const job of batch.jobs)await finish(batch,job,values[job.external_id]||[]);
 await db.query('SELECT analytics_release_cost_history($1,$2,$3)',[ws,batch.connection_id,batch.lease]);
}
async function report(patch={}){return(await db.query('SELECT analytics_abc_components_v19($1,$2,$3,$4) result',[ws,ws,JSON.stringify({...f,...patch}),JSON.stringify(rules)])).rows[0].result;}
async function cost(day,basis='average',sku=skus[0]){return(await db.query('SELECT analytics_cost_at($1,$2,$3,$4) cost',[ws,sku,day,basis])).rows[0].cost;}

test('September uses each sale effective cost, includes opening August cost, and sums quantities times historical cost',()=>fixture(async()=>{
 await publish();const result=await report();
 assert.equal(result.revenue,'20002');assert.equal(result.rows.find(p=>p.sku===skus[0]).revenue,'6500');
 assert.equal(Number(result.composition.periodCostCents),1800);assert.equal(result.composition.costMissingLines,0);
 assert.equal(result.composition.costSource.policy,'effective_date');assert.equal(result.composition.costSource.field,'custoMedio');
 assert.equal(await cost('2026-09-14'),'200.0000');assert.equal(await cost('2026-09-15'),'400.0000');
 const purchase=await report({costBasis:'purchase'});assert.equal(purchase.rows.find(p=>p.sku===skus[0]).revenue,'7501');
 assert.equal(Number(purchase.composition.periodCostCents),1000);
 const invoiced=await report({basis:'invoiced'});assert.equal(invoiced.rows.find(p=>p.sku===skus[0]).revenue,'8000');
}));

test('future cost updates never reprice September; repeated history imports are idempotent and keep audit rows',()=>fixture(async()=>{
 await publish();const before=await report();
 await publish({10:[...histories[10],ev('2026-10-01',99,99)],11:histories[11]});
 assert.deepEqual((await report()).rows,before.rows);assert.equal(await cost('2026-10-01'),'9900.0000');
 const count=(await db.query('SELECT count(*) n FROM analytics_cost_events')).rows[0].n;
 await publish({10:[...histories[10],ev('2026-10-01',99,99)],11:histories[11]});
 assert.equal((await db.query('SELECT count(*) n FROM analytics_cost_events')).rows[0].n,count);
}));

test('corrected backdated costs update only their effective interval and retire old versions audibly',()=>fixture(async()=>{
 await publish();await publish({10:[ev('2026-08-01',1,3),histories[10][1]],11:histories[11]});
 assert.equal(await cost('2026-09-10'),'300.0000');assert.equal(await cost('2026-09-20'),'400.0000');
 const retired=(await db.query('SELECT count(*) n FROM analytics_cost_events WHERE NOT current AND retired_at IS NOT NULL')).rows[0].n;assert.equal(retired,1);
}));

test('partial history never replaces a complete one; a failed next page preserves both checkpoint and published math',()=>fixture(async()=>{
 await publish();const batch=await claim(),job=batch.jobs.find(j=>j.external_id==='10');
 await finish(batch,job,[ev('2026-08-01',1,20)],false);
 assert.equal(await cost('2026-09-10'),'200.0000');
 const next={...job,page_offset:1};await finish(batch,next,[],false,'429 retry');
 const state=(await db.query("SELECT page_offset,last_error FROM analytics_cost_history_sync WHERE external_id='10'")).rows[0];
 assert.equal(state.page_offset,1);assert.equal(state.last_error,'429 retry');
 await finish(batch,next,[histories[10][1]],true);assert.equal(await cost('2026-09-10'),'2000.0000');
}));

test('no earlier history, invalid latest average or simultaneous conflicting costs stay unknown without a future/current/purchase fallback',()=>fixture(async()=>{
 for(const events of [[ev('2026-09-15',1,2)],[ev('2026-08-01',1,2),ev('2026-09-01',3,null)],[ev('2026-08-01',1,0)],[ev('2026-08-01',1,2),ev('2026-08-01',1,4)]]){
  await publish({10:events,11:histories[11]});assert.equal(await cost('2026-09-10'),null);
  await reject(()=>report(),/CMV_REQUIRED:ACFS000-K001/);
  const quantity=await report({metric:'quantity'});assert.equal(Number(quantity.quantity),4);assert.equal(quantity.composition.periodCostCents,null);assert.ok(quantity.composition.costMissingLines>0);
 }
 await publish({10:[],11:histories[11]});assert.equal(await cost('2026-09-10'),null);
}));

test('daily precision is explicit, exact timestamp conflicts are blocked and drilldown does not show one maximum as a fixed period cost',()=>fixture(async()=>{
 await publish({10:[ev('2026-09-01 08:00:00',1,2),ev('2026-09-01 16:00:00',1,3),histories[10][1]],11:histories[11]});
 assert.equal(await cost('2026-09-01'),'300.0000');
 const drill=(await db.query('SELECT analytics_drilldown_components_v19($1,$2,$3,$4,$5) result',[ws,ws,JSON.stringify(f),JSON.stringify(rules),'composition:ACFS000-K001'])).rows[0].result;
 assert.equal(drill.sources[0].referenceCostCents,null);assert.equal(drill.sources[0].costVersions,2);
 assert.equal(drill.sources[0].minReferenceCostCents,'300.0000');assert.equal(drill.sources[0].maxReferenceCostCents,'400.0000');
}));

test('catalog changes enqueue a history refresh; unchanged reads do not refetch histories and browser roles cannot access timelines',()=>fixture(async()=>{
 await publish();await db.query('SELECT analytics_queue_cost_history($1,$2)',[ws,skus]);
 assert.equal((await db.query('SELECT analytics_cost_history_status($1) s',[ws])).rows[0].s.pending,0);
 await db.query("UPDATE analytics_product_costs SET provider_revision='v2' WHERE external_id='10'");
 await db.query('SELECT analytics_queue_cost_history($1,$2)',[ws,skus]);
 assert.equal((await db.query('SELECT analytics_cost_history_status($1) s',[ws])).rows[0].s.pending,1);
 for(const role of ['anon','authenticated']){
  assert.equal((await db.query("SELECT has_table_privilege($1,'analytics_cost_events','select') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_function_privilege($1,'analytics_cost_at(uuid,text,date,text)','execute') allowed",[role])).rows[0].allowed,false);
 }
 await reject(()=>report({costBasis:'forged'}),/INVALID_COST_BASIS/);
}));
