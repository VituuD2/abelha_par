require('./setup.cjs');
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs');
const {isolatedDatabase,ws,connections,filters,query}=require('../scripts/analytics-isolated.cjs');
const {normalizeOrder}=require('../src/lib/analytics/normalize.ts');
const {lineCents,decimalUnits,rankABC}=require('../src/lib/analytics/engine.ts');
const {money}=require('../src/lib/analytics/format.ts');
const source=require('../docs/evidencias/olist2-decimal-20261020145558/diagnostico.json').sanitizedInput;
const migration=readFileSync('supabase/migration_v20_analytics_signed_item_amounts.sql','utf8');
let db;
before(async()=>{db=await isolatedDatabase();});after(async()=>{await db?.close();});

test('the real blocked Olist 2 order preserves the negative item and reconciles with the order total',()=>{
 const result=normalizeOrder(source,connections[1],connections[1],'2026-10-20T15:00:00Z');
 assert.deepEqual(result.items.map(item=>item.gross_cents),['3205','140308','-594']);
 assert.equal(result.items[2].unit_price,'-5.94');assert.equal(result.items[2].quantity,'1');
 assert.equal(result.order.total_cents,'142919');
 assert.equal(result.items.reduce((sum,item)=>sum+BigInt(item.gross_cents),0n).toString(),result.order.total_cents);
 assert.ok(result.order.quality_flags.includes('item_com_preco_negativo'));
 assert.ok(result.order.quality_flags.includes('total_itens_diverge_do_total_produtos'));
 for(const [price,qty,expected] of [['-0.005','1','-1'],['-12.3456','0.5','-617'],['-0.000001','0.1','0'],['-9007199254740993.99','1','-900719925474099399']])assert.equal(lineCents(price,qty),expected);
 assert.throws(()=>decimalUnits('-1'));assert.throws(()=>lineCents('1','-1'));
});

test('invalid fields identify the order and exact item while negative quantities remain rejected',()=>{
 for(const [field,value,pattern]of [['quantidade',-1,/382643017.*item 3.*quantidade/],['quantidade',0,/382643017.*item 3.*quantidade/],['valorUnitario','NaN',/382643017.*item 3.*valorUnitario/],['valorUnitario','- 5.94',/382643017.*item 3.*valorUnitario/]]){
  const raw=structuredClone(source);raw.itens[2][field]=value;
  assert.throws(()=>normalizeOrder(raw,'c','s','now'),pattern);
 }
 const raw={...source,valorTotalPedido:-1,valorTotalProdutos:-1,valorDesconto:-0.5};
 const signed=normalizeOrder(raw,'c','s','now');assert.equal(signed.order.total_cents,'-100');assert.equal(signed.order.discount_cents,'-50');
});

test('v20 alone permits atomic idempotent ingestion and signed ABC totals while preserving the 522-order checkpoint',async()=>{
 const pending=Array.from({length:51},(_,i)=>i===43?'382643017':String(400000000+i));
 const inserted=(await db.query(`INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,pages,processed,pending_ids,pending_index,page_done)
 VALUES($1,$2,'backfill','2026-08-01','2026-10-02','2026-08-10',10,522,$3,43,true) RETURNING id`,[ws,connections[1],JSON.stringify(pending)])).rows[0];
 const job=(await db.query('SELECT * FROM analytics_claim_job($1)',[ws])).rows[0];assert.equal(job.id,inserted.id);
 const n=normalizeOrder(source,connections[1],connections[1],'2026-10-20T15:00:00Z');
 const ingest=()=>db.query('SELECT analytics_ingest($1,$2,$3,$4) id',[job.id,job.lease_token,JSON.stringify(n.order),JSON.stringify(n.items)]);
 await db.exec('BEGIN; SAVEPOINT old_schema');await assert.rejects(ingest,/analytics_items_(unit_price|gross_cents)_check/);await db.exec('ROLLBACK TO SAVEPOINT old_schema; COMMIT');
 assert.equal((await db.query('SELECT count(*) n FROM analytics_orders')).rows[0].n,0);
 await db.exec(migration);await db.exec(migration);
 const checkpoint=(await db.query('SELECT processed,pending_index,pages,cursor_date::text cursor_date FROM analytics_sync_jobs WHERE id=$1',[job.id])).rows[0];
 assert.deepEqual(checkpoint,{processed:522,pending_index:43,pages:10,cursor_date:'2026-08-10'});
 const first=(await ingest()).rows[0].id;assert.equal((await ingest()).rows[0].id,first);
 const stored=(await db.query('SELECT unit_price,gross_cents FROM analytics_items WHERE position=2')).rows[0];
 assert.equal(stored.unit_price,'-5.940000');assert.equal(stored.gross_cents,'-594');
 assert.equal((await db.query('SELECT count(*) n FROM analytics_orders')).rows[0].n,1);assert.equal((await db.query('SELECT count(*) n FROM analytics_items')).rows[0].n,3);
 const result=await query(db,{...filters,from:'2026-08-01',to:'2026-10-02'});
 assert.equal(result.revenue,'142919');assert.equal(Number(result.quantity),6);assert.equal(result.rows.find(row=>row.sku==='SBLL001-K001').revenue,'-594');
 const ranked=rankABC(result.rows);assert.deepEqual(ranked.map(row=>[row.entityId,row.rank,row.class]),result.rows.map(row=>[row.entityId,row.rank,row.class]));
 await db.exec('BEGIN; SAVEPOINT invalid_quantity');await assert.rejects(()=>db.query('UPDATE analytics_items SET quantity=-1 WHERE position=2'),/analytics_items_quantity_check/);await db.exec('ROLLBACK TO SAVEPOINT invalid_quantity; COMMIT');
 await db.exec('BEGIN; SAVEPOINT invalid_sign');await assert.rejects(()=>db.query('UPDATE analytics_items SET gross_cents=594 WHERE position=2'),/analytics_items_amount_sign_check/);await db.exec('ROLLBACK TO SAVEPOINT invalid_sign; COMMIT');
});

test('money displays signed amounts and exact PostgreSQL numeric costs with sub-cent display rounding',()=>{
 assert.match(money('-594'),/5,94/);assert.ok(money('-594').startsWith('−'));
 assert.equal(money('1800.0000000000'),money('1800'));
 assert.equal(money('-0.5000'),money('-1'));assert.equal(money('100.4999'),money('100'));
});
