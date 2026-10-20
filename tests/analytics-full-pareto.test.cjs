require('./setup.cjs');
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),{readFileSync}=require('node:fs');
const {isolatedDatabase,ws,connections,filters}=require('../scripts/analytics-isolated.cjs');
const {buildCompositionRules}=require('../src/lib/analytics/composition.ts');
const migration=readFileSync('supabase/migration_v22_analytics_full_pareto.sql','utf8');
const rules=buildCompositionRules([],'full-chart',[],{baseProducts:Array.from({length:164},(_,i)=>({sku:'SKU'+String(i+1).padStart(3,'0'),name:'Produto '+(i+1)}))});
let db,beforeRaw,beforeComposed;
async function report(grouping='product',offset=0,limit=25,patch={},sort='rank',direction='asc'){
 const composed=grouping==='composition';
 const args=[ws,ws,JSON.stringify({...filters,grouping,costBasis:'purchase',...patch})];
 if(composed)args.push(JSON.stringify(rules));
 args.push(offset,limit,sort,direction);
 const placeholders=args.map((_,i)=>'$'+(i+1)).join(',');
 return(await db.query(`SELECT ${composed?'analytics_abc_components_v21':'analytics_abc'}(${placeholders}) result`,args)).rows[0].result;
}
before(async()=>{
 db=await isolatedDatabase();
 for(const file of ['migration_v14_v15_analytics_complete.sql','migration_v16_analytics_confirmed_unlinked.sql','migration_v18_analytics_olist_costs.sql','migration_v19_analytics_cost_effective_dates.sql','migration_v20_analytics_signed_item_amounts.sql','migration_v21_analytics_zero_signed_costs.sql'])await db.exec(readFileSync(`supabase/${file}`,'utf8'));
 await db.query(`INSERT INTO analytics_products(workspace_id,connection_id,external_id,sku,name,parent_id,parent_name)
  SELECT $1,$2,i::text,'SKU'||lpad(i::text,3,'0'),'Produto '||i,ceil(i/2.0)::integer::text,'Pai '||ceil(i/2.0)::integer FROM generate_series(1,164) i`,[ws,connections[0]]);
 await db.query(`INSERT INTO analytics_orders(workspace_id,company_id,connection_id,source_id,canonical_key,external_id,customer_key,customer_name,sale_date,status,total_cents,fetched_at)
  SELECT $1,$2,$2,$2,i::text,i::text,'customer:'||i,'Cliente '||i,'2026-09-10',1,i,now() FROM generate_series(1,164) i`,[ws,connections[0]]);
 await db.query(`INSERT INTO analytics_items(workspace_id,order_id,position,connection_id,product_id,quantity,unit_price,gross_cents)
  SELECT $1,id,0,connection_id,external_id,1,total_cents/100,total_cents FROM analytics_orders WHERE workspace_id=$1`,[ws]);
 beforeRaw=await report();beforeComposed=await report('composition');
 assert.equal(beforeRaw.pareto.length,60);assert.equal(beforeComposed.pareto.length,60);
 await db.exec(migration);await db.exec(migration);
});
after(async()=>{await db?.close();});

test('full chart includes every product, customer and parent while the table remains paginated',async()=>{
 for(const [grouping,total] of [['product',164],['parent',82],['customer',164],['composition',164]]){
  const result=await report(grouping);assert.equal(result.total,total);assert.equal(result.rows.length,25);
  assert.equal(result.pareto.length,total);assert.equal(result.pareto.at(-1).rank,total);
  assert.ok(Math.abs(result.pareto.at(-1).cumulative-100)<1e-9);
  assert.equal(result.pareto.reduce((sum,row)=>sum+BigInt(row.revenue),0n),BigInt(result.revenue));
  assert.equal(new Set(result.pareto.map(row=>row.entityId)).size,total);
 }
});

test('paging, table sorting and filters preserve the global chart ranking and the v21 cost policy',async()=>{
 const first=await report(),next=await report('product',25,25,{},'revenue','asc');
 assert.deepEqual(next.pareto,first.pareto);assert.notDeepEqual(next.rows,first.rows);
 assert.deepEqual(first.rows,beforeRaw.rows);assert.equal(first.revenue,beforeRaw.revenue);
 const composed=await report('composition');assert.deepEqual(composed.composition,beforeComposed.composition);
 const narrowed=await report('product',0,25,{selections:{skus:['SKU001','SKU002','SKU003']}});
 assert.equal(narrowed.total,3);assert.equal(narrowed.pareto.length,3);assert.ok(narrowed.pareto.every(row=>['SKU001','SKU002','SKU003'].includes(row.sku)));
 for(const role of ['anon','authenticated'])assert.equal((await db.query("SELECT has_function_privilege($1,'analytics_abc(uuid,uuid,jsonb,integer,integer,text,text)','execute') allowed",[role])).rows[0].allowed,false);
});
