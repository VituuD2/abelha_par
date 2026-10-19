// Synthetic, isolated PostgreSQL WASM only. Never loads .env or contacts services.
require('../tests/setup.cjs');
const { isolatedDatabase, ws, connections, filters, query } = require('./analytics-isolated.cjs');
const fs = require('node:fs');
const { performance } = require('node:perf_hooks');
async function main() {
  const db=await isolatedDatabase();
  const out={at:new Date().toISOString(),runtime:process.version,environment:'PGlite in-memory, synthetic; one process/connection; not production concurrency',scenarios:[]};
  try {
    const c=connections[0];
    await db.query("INSERT INTO analytics_products(workspace_id,connection_id,external_id,name,sku) SELECT $1,$2,g::text,'Produto '||g,'SKU-'||g FROM generate_series(1,5000) g",[ws,c]);
    let previous=0;
    for(const n of [10000,50000,100000]) {
      const seed=performance.now();
      await db.query(`INSERT INTO analytics_orders(id,workspace_id,company_id,connection_id,source_id,canonical_key,external_id,customer_key,customer_name,sale_date,status,total_cents,fetched_at)
        SELECT md5('benchmark-order-'||g)::uuid,$1,$2,$2,$2,g::text,g::text,'customer','Cliente sintético','2026-09-01'::date+(g%30)::integer,1,1000+g%100,now() FROM generate_series($3::integer,$4::integer) g`,[ws,c,previous+1,n]);
      await db.query(`INSERT INTO analytics_items(workspace_id,order_id,position,connection_id,product_id,quantity,unit_price,gross_cents)
        SELECT $1,md5('benchmark-order-'||g)::uuid,0,$2,(1+g%5000)::text,1,10+(g%100)/100.0,1000+g%100 FROM generate_series($3::integer,$4::integer) g`,[ws,c,previous+1,n]);
      await db.exec('ANALYZE analytics_orders; ANALYZE analytics_items; ANALYZE analytics_products;');
      const entry={orders:n,items:n,products:5000,seedMs:Math.round(performance.now()-seed),sqlMs:[]};
      let r;
      for(let i=0;i<3;i++){const start=performance.now();r=await query(db,filters,0,100);entry.sqlMs.push(Math.round((performance.now()-start)*100)/100);}
      entry.pageRows=r.rows.length;entry.entities=r.total;entry.paretoPoints=r.pareto.length;entry.jsonBytes=Buffer.byteLength(JSON.stringify(r));
      const start=performance.now();const all=await query(db,filters,0,-1);entry.exportAggregationMs=Math.round(performance.now()-start);entry.exportEntities=all.rows.length;entry.exportJsonBytes=Buffer.byteLength(JSON.stringify(all));
      const filteredStart=performance.now();await query(db,{...filters,selections:{...filters.selections,products:[c+':10']}});entry.productFilterMs=Math.round(performance.now()-filteredStart);
      const concurrentStart=performance.now();await Promise.all([query(db),query(db),query(db)]);entry.threeSerializedQueriesMs=Math.round(performance.now()-concurrentStart);
      entry.rssMiB=Math.round(process.memoryUsage().rss/1048576);
      entry.explain=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT * FROM analytics_filtered_items($1,$2)',[ws,JSON.stringify(filters)])).rows;
      out.scenarios.push(entry);console.log(JSON.stringify({...entry,explain:'recorded'}));previous=n;
    }
    const dir='docs/evidencias/curva-abc-2026-10-16';fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/benchmark-isolado.json',JSON.stringify(out,null,2));
  }finally{await db.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
