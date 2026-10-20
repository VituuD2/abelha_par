require('./setup.cjs');
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs');
const {isolatedDatabase,ws,connections,filters}=require('../scripts/analytics-isolated.cjs');
const {compositionRulesForWorkspace}=require('../src/lib/analytics/composition-server.ts');
const {normalizeCostHistoryPage}=require('../src/lib/analytics/cost-history-sync.ts');
const {normalizeOrder}=require('../src/lib/analytics/normalize.ts');
const {exportMetadata}=require('../src/lib/analytics/export.ts');
const {money}=require('../src/lib/analytics/format.ts');
const catalog=require('../src/lib/analytics/data/composition-catalog.json');
const evidence=require('../docs/evidencias/olist-cmv-20261020161446/diagnostico.json');
const rules=compositionRulesForWorkspace(catalog.workspaceIds[0]);
const f={...filters,grouping:'composition',costBasis:'purchase'};
const skus=['ACFS000-K001','ACTM000-K010'];let db;
before(async()=>{
 db=await isolatedDatabase();
 for(const file of ['migration_v14_v15_analytics_complete.sql','migration_v16_analytics_confirmed_unlinked.sql','migration_v18_analytics_olist_costs.sql','migration_v19_analytics_cost_effective_dates.sql','migration_v20_analytics_signed_item_amounts.sql','migration_v21_analytics_zero_signed_costs.sql','migration_v21_analytics_zero_signed_costs.sql'])await db.exec(readFileSync(`supabase/${file}`,'utf8'));
 await db.query("UPDATE analytics_companies SET tax_id='13397731000164' WHERE id=$1",[connections[0]]);
 await db.query('SELECT analytics_seed_cost_sources()');
 for(const [i,sku]of skus.entries())await db.query(`INSERT INTO analytics_product_costs(workspace_id,connection_id,external_id,sku,cost_cents,active,scan_id,provider_revision) VALUES($1,$2,$3,$4,0,true,gen_random_uuid(),'v1')`,[ws,connections[0],String(i+10),sku]);
 await db.query('SELECT analytics_queue_cost_history($1,$2)',[ws,skus]);
 await db.query(`INSERT INTO analytics_products(workspace_id,connection_id,external_id,sku,name) VALUES($1,$2,'1','ACTM011-K011','Kit')`,[ws,connections[0]]);
 await sale();
});
after(async()=>{await db?.close();});
const ev=(precoCusto,data='2000-01-01',custoMedio=precoCusto)=>({data,precoCusto,custoMedio});
async function fixture(fn){await db.exec('BEGIN');try{await fn();}finally{await db.exec('ROLLBACK');}}
async function reject(fn,pattern){await db.exec('SAVEPOINT expected_error');await assert.rejects(fn,pattern);await db.exec('ROLLBACK TO SAVEPOINT expected_error');}
async function sale({externalId='389268170',date='2026-09-10',price='28.38',quantity='1'}={}){
 const raw={id:externalId,data:date,situacao:6,valorTotalPedido:price,valorTotalProdutos:price,itens:[{produto:{id:1,sku:'ACTM011-K011'},quantidade:quantity,valorUnitario:price}]};
 const normalized=normalizeOrder(raw,connections[0],connections[0],'2026-10-20T16:00:00Z');
 const order=(await db.query(`INSERT INTO analytics_orders(workspace_id,company_id,connection_id,source_id,canonical_key,external_id,customer_key,customer_name,sale_date,status,total_cents,fetched_at) VALUES($1,$2,$2,$2,$3,$3,'customer','Cliente',$4,6,$5,now()) RETURNING id`,[ws,connections[0],externalId,date,normalized.order.total_cents])).rows[0].id;
 const item=normalized.items[0];
 await db.query(`INSERT INTO analytics_items(workspace_id,order_id,position,connection_id,product_id,quantity,unit_price,gross_cents) VALUES($1,$2,0,$3,'1',$4,$5,$6)`,[ws,order,connections[0],item.quantity,item.unit_price,item.gross_cents]);
}
async function publish(histories){
 await db.query('UPDATE analytics_connections SET sync_locked_until=null WHERE id=$1',[connections[0]]);
 await db.query('SELECT analytics_queue_cost_history($1,$2,true)',[ws,skus]);
 const batch=(await db.query('SELECT analytics_claim_cost_history() batch')).rows[0].batch;assert.ok(batch);
 for(const job of batch.jobs){
  const page=normalizeCostHistoryPage({itens:histories[job.external_id]||[]},0);
  await db.query('SELECT analytics_finish_cost_history_page($1,$2,$3,$4,$5,$6,0,$7,$8,true)',[ws,batch.connection_id,batch.lease,batch.connection_version,job.external_id,job.scan_id,page.count,JSON.stringify(page.events)]);
 }
 await db.query('SELECT analytics_release_cost_history($1,$2,$3)',[ws,batch.connection_id,batch.lease]);
}
async function report(patch={},customRules=rules){return(await db.query('SELECT analytics_abc_components_v19($1,$2,$3,$4) result',[ws,ws,JSON.stringify({...f,...patch}),JSON.stringify(customRules)])).rows[0].result;}
async function cost(day,basis='purchase'){return(await db.query('SELECT analytics_cost_at($1,$2,$3,$4) cost',[ws,skus[0],day,basis])).rows[0].cost;}
const row=(result,sku)=>result.rows.find(r=>r.sku===sku);
function conserved(result,expected){assert.equal(result.revenue,String(expected));assert.equal(result.rows.reduce((sum,r)=>sum+BigInt(r.revenue),0n),BigInt(expected));assert.equal(result.composition.unallocatedLines,0);assert.equal(result.composition.costMissingLines,0);}

test('real September kit accepts the ERP zero cost for Fita Seios and preserves its quantity and full sale revenue',()=>fixture(async()=>{
 await publish({10:evidence.provider[0].itens,11:[ev(1.65)]});
 const result=await report();conserved(result,2838);
 assert.equal(row(result,skus[0]).revenue,'0');assert.equal(Number(row(result,skus[0]).quantity),1);
 assert.equal(row(result,skus[1]).revenue,'2838');assert.equal(Number(result.composition.periodCostCents),165);
 assert.equal(result.composition.zeroCostLines,1);assert.deepEqual(result.composition.missingCostSkus,[]);
 assert.equal(await cost('2026-09-10'),'0.0000');
 // Average zero is a valid explicit value too; no method substitution.
 conserved(await report({costBasis:'average'}),2838);
}));

test('all zero costs divide by component quantities with deterministic residual cents and no division by zero',()=>fixture(async()=>{
 await publish({10:[ev(0)],11:[ev(0)]});
 const custom=structuredClone(rules);custom.bundles['ACTM011-K011'].components.find(c=>c.target===skus[1]).factor='3';
 const result=await report({},custom);conserved(result,2838);
 assert.equal(row(result,skus[0]).revenue,'710');assert.equal(row(result,skus[1]).revenue,'2128');
 assert.equal(Number(result.composition.periodCostCents),0);assert.equal(result.composition.quantityAllocationLines,1);
 assert.equal(result.composition.mixedLines,1);assert.equal(result.composition.costSource.allocationPolicy,'signed_cost_magnitude_zero_quantity');
 await sale({externalId:'2',price:'-28.38'});conserved(await report({},custom),0);
 await db.query("UPDATE analytics_items SET unit_price=0,gross_cents=0 WHERE order_id IN (SELECT id FROM analytics_orders WHERE workspace_id=$1)",[ws]);
 const zero=await report({},custom);conserved(zero,0);assert.ok(zero.rows.every(r=>r.class==='C'));
}));

test('signed costs use magnitudes for revenue allocation but their original sign for CMV, including credit sales',()=>fixture(async()=>{
 await publish({10:[ev(-1)],11:[ev(2)]});
 await db.query('UPDATE analytics_product_costs SET cost_cents=-100 WHERE workspace_id=$1',[ws]);
 const result=await report();conserved(result,2838);
 assert.equal(row(result,skus[0]).revenue,'946');assert.equal(row(result,skus[1]).revenue,'1892');
 assert.equal(Number(result.composition.periodCostCents),100);assert.equal(result.composition.negativeCostLines,1);
 await publish({10:[ev(-1)],11:[ev(-2)]});
 const negative=await report();conserved(negative,2838);assert.equal(Number(negative.composition.periodCostCents),-300);
 await db.query('DELETE FROM analytics_orders WHERE workspace_id=$1',[ws]);
 await sale({externalId:'2',price:'-28.38'});
 const credit=await report();conserved(credit,-2838);
 assert.equal(row(credit,skus[0]).revenue,'-946');assert.equal(row(credit,skus[1]).revenue,'-1892');
 assert.equal(Number(credit.composition.periodCostCents),-300);
}));

test('zero and negative changes respect effective dates; a later nonzero value never replaces a dated zero',()=>fixture(async()=>{
 await publish({10:[ev(5,'2026-08-01'),ev(0,'2026-09-01'),ev(-1,'2026-09-15'),ev(99,'2026-10-01')],11:[ev(1.65)]});
 assert.equal(await cost('2026-07-31'),null);assert.equal(await cost('2026-08-31'),'500.0000');
 assert.equal(await cost('2026-09-10'),'0.0000');assert.equal(await cost('2026-09-20'),'-100.0000');
 const september=await report();conserved(september,2838);assert.equal(Number(september.composition.periodCostCents),165);
 await sale({externalId:'2',date:'2026-09-20'});
 const period=await report();conserved(period,5676);assert.equal(Number(period.composition.periodCostCents),230);
 const detail=(await db.query('SELECT analytics_drilldown_components_v19($1,$2,$3,$4,$5) result',[ws,ws,JSON.stringify(f),JSON.stringify(rules),'composition:ACFS000-K001'])).rows[0].result;
 assert.equal(detail.sources[0].costVersions,2);assert.equal(detail.sources[0].minReferenceCostCents,'-100.0000');assert.equal(detail.sources[0].maxReferenceCostCents,'0.0000');
}));

test('atomic ingestion accepts a negative order total, discount and item after v20/v21 without changing the checkpoint',()=>fixture(async()=>{
 await publish({10:[ev(0)],11:[ev(1.65)]});
 await db.query(`INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,processed) VALUES($1,$2,'backfill','2026-09-01','2026-09-30','2026-09-20',42)`,[ws,connections[0]]);
 await db.query('UPDATE analytics_connections SET sync_locked_until=null WHERE id=$1',[connections[0]]);
 const job=(await db.query('SELECT * FROM analytics_claim_job($1)',[ws])).rows[0];assert.ok(job);
 const raw={id:'2',data:'2026-09-20',situacao:6,valorTotalPedido:-28.38,valorTotalProdutos:-28.38,valorDesconto:-0.5,itens:[{produto:{id:1,sku:'ACTM011-K011'},quantidade:1,valorUnitario:-28.38}]};
 const n=normalizeOrder(raw,connections[0],connections[0],'2026-10-20T16:00:00Z');
 const ingest=()=>db.query('SELECT analytics_ingest($1,$2,$3,$4) id',[job.id,job.lease_token,JSON.stringify(n.order),JSON.stringify(n.items)]);
 const first=(await ingest()).rows[0].id;assert.equal((await ingest()).rows[0].id,first);
 const order=(await db.query('SELECT total_cents,discount_cents FROM analytics_orders WHERE id=$1',[first])).rows[0];
 assert.equal(order.total_cents,'-2838');assert.equal(order.discount_cents,'-50');
 assert.equal((await db.query('SELECT processed FROM analytics_sync_jobs WHERE id=$1',[job.id])).rows[0].processed,42);
 conserved(await report(),0);
}));

test('absent dates, unknown costs and contradictory same-time costs remain unknown instead of becoming zero',()=>fixture(async()=>{
 for(const events of [[],[ev(null)],[ev(0,'2026-09-15')],[ev(0),ev(-1)]]){
  await publish({10:events,11:[ev(1.65)]});assert.equal(await cost('2026-09-10'),null);
  await reject(()=>report(),/CMV_REQUIRED:ACFS000-K001/);
  const quantity=await report({metric:'quantity'});assert.equal(quantity.composition.costMissingLines,1);assert.equal(quantity.composition.periodCostCents,null);
 }
}));

test('exports and formatting identify zero, negative and quantity-based allocations while database privacy remains intact',()=>fixture(async()=>{
 await publish({10:[ev(0)],11:[ev(0)]});const result=await report();
 const metadata=exportMetadata(f,result);
 assert.match(metadata.find(([label])=>label==='Composição · valor')[1],/magnitude.*todos os custos zero/);
 assert.equal(metadata.find(([label])=>label==='Composição · kits rateados por quantidade por custos zerados')[1],'1');
 assert.equal(money('0.0000'),money('0'));assert.equal(money('-100.0000'),money('-100'));
 for(const role of ['anon','authenticated']){
  assert.equal((await db.query("SELECT has_function_privilege($1,'analytics_cost_at(uuid,text,date,text)','execute') allowed",[role])).rows[0].allowed,false);
  assert.equal((await db.query("SELECT has_table_privilege($1,'analytics_cost_events','select') allowed",[role])).rows[0].allowed,false);
 }
}));
