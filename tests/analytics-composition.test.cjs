require('./setup.cjs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { isolatedDatabase, ws, connections, filters, query } = require('../scripts/analytics-isolated.cjs');
const { buildCompositionRules } = require('../src/lib/analytics/composition.ts');
const { compositionRulesForWorkspace } = require('../src/lib/analytics/composition-server.ts');
const { parseABCFilters } = require('../src/lib/analytics/filters.ts');
const { exportMetadata } = require('../src/lib/analytics/export.ts');
const { rankABC } = require('../src/lib/analytics/engine.ts');
const catalog = require('../src/lib/analytics/data/composition-catalog.json');
const {rules} = require('./legacy-composition-rules.cjs');
const composedFilters = { ...filters, grouping: 'composition' };
let db, sale;
const migration = readFileSync('supabase/migration_v14_v15_analytics_complete.sql', 'utf8');
before(async () => {
  // Validate the artifact users apply after v13, including reproducibility and reapplication.
  assert.equal(migration.replace(/\r\n/g,'\n'),require('../scripts/build-analytics-migration.cjs').buildMigration());
  db = await isolatedDatabase();
  await db.exec(migration);
  await db.exec(migration);
  const unlinkedMigration=readFileSync('supabase/migration_v16_analytics_confirmed_unlinked.sql','utf8');
  await db.exec(unlinkedMigration);
  await db.exec(unlinkedMigration);
  let id = 100;
  sale = async function(connection, items, { status = 1, date = '2026-09-10', invoiced = false } = {}) {
    const external = String(++id), total = items.reduce((sum, item) => sum + BigInt(item.cents), 0n).toString();
    const order = (await db.query(`INSERT INTO analytics_orders(workspace_id,company_id,connection_id,source_id,canonical_key,external_id,number,customer_key,customer_name,sale_date,status,total_cents,fetched_at,invoice_eligible,invoice_date)
      VALUES($1,$2,$2,$2,$3,$3,$3,'customer','Cliente',$4,$5,$6,now(),$7,$4) RETURNING id`, [ws, connection, external, date, status, total, invoiced])).rows[0].id;
    for (const [position, item] of items.entries()) {
      const product = item.unlinked ? `order:${external}:item:${position}` : String(item.product);
      await db.query(`INSERT INTO analytics_products(workspace_id,connection_id,external_id,sku,name) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [ws, connection, product, item.sku, item.sku]);
      await db.query(`INSERT INTO analytics_items(workspace_id,order_id,position,connection_id,product_id,quantity,unit_price,gross_cents) VALUES($1,$2,$3,$4,$5,$6,1,$7)`, [ws, order, position, connection, product, item.qty, item.cents]);
    }
  }
  await sale(connections[0], [{product:1,sku:'HBCOMAX-K001',qty:2,cents:1000},{product:2,sku:'HBCOMAX-K003S',qty:2,cents:6000}], { invoiced: true });
  await sale(connections[1], [{product:1,sku:'HBCOMAX-K001',qty:1,cents:500},{product:2,sku:'HBCOMAX-K001S',qty:1,cents:700}]);
  await sale(connections[0], [{product:3,sku:'CMPO0DN-K002S',qty:3,cents:3000}]);
  await sale(connections[0], [{sku:'HBCOMAX-K001S',qty:1,cents:100,unlinked:true}]);
  await sale(connections[0], [{product:4,sku:'HBCOMAX-K999S',qty:2,cents:2000}]);
  await sale(connections[0], [{product:5,sku:'EXTRA',qty:1,cents:400}]);
  await sale(connections[1], [{product:5,sku:'EXTRA',qty:1,cents:500}]);
  await sale(connections[0], [{product:2,sku:'HBCOMAX-K003S',qty:10,cents:9000}], { status: 2 });
  await sale(connections[0], [{product:2,sku:'HBCOMAX-K003S',qty:10,cents:9000}], { date: '2026-08-10' });
});
after(async () => db?.close());
async function report(f = composedFilters, limit = 50, sort = 'rank', direction = 'asc', ruleSet = rules, actor = ws) {
  return (await db.query('SELECT analytics_abc_components_v16($1,$2,$3,$4,0,$5,$6,$7) result', [ws,actor,JSON.stringify(f),JSON.stringify(ruleSet),limit,sort,direction])).rows[0].result;
}

test('catalog accepts only documented links, exact quantities and the authorized workspace', () => {
  assert.deepEqual(rules.rules['HBCOMAX-K001S'], {target:'HBCOMAX-K001',name:'Corega 70g MAX Combo',factor:'1'});
  assert.equal(rules.rules['HBCOMAX-K003S'].factor, '3');
  assert.equal(rules.rules['3139P'].factor, '6');
  assert.equal(rules.rules['HBCOMAX-K999S'], undefined);
  assert.equal(rules.rules['CMPO0DN-K002S'], undefined);
  assert.equal(rules.bundles['CMPO0DN-K002S'].components.length, 2);
  assert.equal(compositionRulesForWorkspace(catalog.workspaceIds[0]).version, catalog.version);
  assert.throws(() => compositionRulesForWorkspace(ws), /espaço de trabalho/);
  assert.equal(parseABCFilters(composedFilters).grouping, 'composition');
});

test('nested decimal conversions stay exact; cycles, invalid factors and conflicting evidence stay pending', () => {
  const kit = (sku, target, quantity) => ({sku,name:sku,components:[{sku:target,name:target,quantity}]});
  const r = buildCompositionRules([kit('A','B','0.125'),kit('B','C','2.4'),kit('X','Y','1'),kit('Y','X','1'),kit('Z','C','0'),kit('D','C','1'),kit('D','C','2')], 'test');
  assert.equal(r.rules.A.factor, '0.3');
  assert.equal(r.rules.C.factor, '1');
  for (const key of ['X','Y','Z','D']) { assert.equal(r.rules[key],undefined); assert.ok(r.pending[key]); }
});

test('approved packaging exclusion consolidates the tape while preserving packaged SKUs and distinct conversion factors', async () => {
  assert.deepEqual(rules.rules['ACBF000-K100ES'].ignoredComponents,['EBBF001-001']);
  assert.equal(rules.rules['ACBF000-K100ES'].target,'ACBF000-K050');
  assert.equal(rules.rules['ACBF000-K100ES'].factor,'2');
  assert.equal(rules.rules['ACBF000-K050'].ignoredComponents,undefined);
  await db.exec('BEGIN');
  try {
    const connection=connections[2];
    for(const [id,sku]of [['201','ACBF000-K050'],['202','ACBF000-K050ES'],['203','ACBF000-K100ES']])
      await db.query('INSERT INTO analytics_products(workspace_id,connection_id,external_id,sku,name) VALUES($1,$2,$3,$4,$4)',[ws,connection,id,sku]);
    const order=(await db.query(`INSERT INTO analytics_orders(workspace_id,company_id,connection_id,source_id,canonical_key,external_id,customer_key,customer_name,sale_date,status,total_cents,fetched_at)
      VALUES($1,$2,$2,$2,'packaging-test','901','customer','Cliente','2026-09-10',1,900,now()) RETURNING id`,[ws,connection])).rows[0].id;
    for(const [position,id,cents]of [[0,'201',100],[1,'202',300],[2,'203',500]])
      await db.query('INSERT INTO analytics_items(workspace_id,order_id,position,connection_id,product_id,quantity,unit_price,gross_cents) VALUES($1,$2,$3,$4,$5,1,1,$6)',[ws,order,position,connection,id,cents]);
    const f={...composedFilters,selections:{companies:[connection]}};
    const r=await report(f);
    assert.equal(r.total,1);
    assert.equal(r.revenue,'900');
    assert.equal(Number(r.quantity),4);
    assert.equal(r.orders,1);
    assert.deepEqual(r.composition.ignoredComponentSkus,['EBBF001-001']);
    const drill=(await db.query('SELECT analytics_drilldown_components_v16($1,$2,$3,$4,$5) result',[ws,ws,JSON.stringify(f),JSON.stringify(rules),'composition:ACBF000-K050'])).rows[0].result;
    assert.equal(drill.sources.length,3);
    assert.equal(drill.sources.filter(s=>s.ignoredComponents.length).length,2);
    assert.equal(drill.sources.find(s=>s.sku==='ACBF000-K100ES').factor,'2');
    assert.equal(drill.orders[0].revenue,'900');
  } finally {await db.exec('ROLLBACK');}
});

test('composition consolidates explicit SKUs across companies, converts units and conserves every cent and distinct order', async () => {
  const raw = await query(db), r = await report();
  assert.equal(raw.total, 9);
  assert.equal(r.total, 7);
  assert.equal(r.revenue, '14200');
  assert.equal(r.revenue, raw.revenue);
  assert.equal(r.orders, raw.orders);
  assert.equal(r.orders, 7);
  assert.equal(Number(r.quantity),21);
  const corega = r.rows.find(row => row.sku === 'HBCOMAX-K001');
  assert.equal(corega.entityId, 'composition:HBCOMAX-K001');
  assert.equal(corega.revenue,'8200');
  assert.equal(Number(corega.quantity),10);
  assert.equal(corega.orders,2);
  assert.equal(r.rows.filter(row => row.sku === 'EXTRA').length,2);
  assert.ok(r.rows.some(row => row.entityId.includes(':order:') && row.sku === 'HBCOMAX-K001S'));
  assert.equal(r.composition.pendingTotal,1);
  assert.deepEqual(r.composition.pending.map(row => row.sku),['HBCOMAX-K999S']);
});

test('new analytical classifications preserve cents while converting Camel Toe, typo kit and inventory pack units',async()=>{
  await db.exec('BEGIN');
  try {
    const connection=connections[2];
    const lines=[['301','ACAI000-K001',1,1000],['302','ACAI000-K002',2,4000],['303','HBCO40M-K022S',1,1000],['304','ACOP000-K036S',1,500],['305','SBES004-K001S',1,100]];
    const order=(await db.query(`INSERT INTO analytics_orders(workspace_id,company_id,connection_id,source_id,canonical_key,external_id,customer_key,customer_name,sale_date,status,total_cents,fetched_at)
      VALUES($1,$2,$2,$2,'classification-test','902','customer','Cliente','2026-09-10',1,6600,now()) RETURNING id`,[ws,connection])).rows[0].id;
    for(const [position,[id,sku,quantity,cents]]of lines.entries()) {
      await db.query('INSERT INTO analytics_products(workspace_id,connection_id,external_id,sku,name) VALUES($1,$2,$3,$4,$4)',[ws,connection,id,sku]);
      await db.query('INSERT INTO analytics_items(workspace_id,order_id,position,connection_id,product_id,quantity,unit_price,gross_cents) VALUES($1,$2,$3,$4,$5,$6,1,$7)',[ws,order,position,connection,id,quantity,cents]);
    }
    const f={...composedFilters,selections:{companies:[connection]}};
    const r=await report(f);
    assert.equal(r.revenue,'6600');
    assert.equal(r.total,4);
    assert.equal(r.orders,1);
    assert.equal(Number(r.quantity),9);
    assert.equal(Number(r.rows.find(row=>row.sku==='ACAI000-K001').quantity),5);
    assert.equal(Number(r.rows.find(row=>row.sku==='HBCO40M-K001').quantity),2);
    assert.equal(Number(r.rows.find(row=>row.sku==='ACOP000-K036').quantity),1);
    assert.ok(r.rows.some(row=>row.sku==='SBES002-K001'));
    const onlyKit=await report({...f,selections:{...f.selections,skus:['ACAI000-K002']}});
    assert.equal(onlyKit.revenue,'4000');
    assert.equal(Number(onlyKit.quantity),4);
    const raw=await query(db,{...f,grouping:'product'});
    assert.equal(raw.revenue,r.revenue);
  } finally {await db.exec('ROLLBACK');}
});

test('original product/SKU, company and invoice filters apply before composition and never widen the scope', async () => {
  const kitOnly = await report({...composedFilters,selections:{skus:['HBCOMAX-K003S']}});
  assert.equal(kitOnly.total,1);
  assert.equal(kitOnly.revenue,'6000');
  assert.equal(Number(kitOnly.quantity),6);
  const company = await report({...composedFilters,selections:{companies:[connections[1]]}});
  assert.equal(company.revenue,'1700');
  assert.equal(Number(company.rows.find(row => row.sku==='HBCOMAX-K001').quantity),2);
  const product = await report({...composedFilters,selections:{products:[`${connections[0]}:1`]}});
  assert.equal(product.revenue,'1000');
  const invoiced = await report({...composedFilters,basis:'invoiced'});
  assert.equal(invoiced.revenue,'7000');
  assert.equal(Number(invoiced.quantity),8);
});

test('drilldown traces original SKUs, conversion factors and order amounts without double counting', async () => {
  const r = (await db.query('SELECT analytics_drilldown_components_v16($1,$2,$3,$4,$5) result',[ws,ws,JSON.stringify(composedFilters),JSON.stringify(rules),'composition:HBCOMAX-K001'])).rows[0].result;
  assert.equal(r.total,2);
  assert.equal(r.companies.length,2);
  assert.equal(r.sources.length,3);
  assert.equal(r.orders.reduce((sum,row)=>sum+BigInt(row.revenue),0n),8200n);
  assert.equal(r.sources.reduce((sum,row)=>sum+BigInt(row.revenue),0n),8200n);
  assert.equal(r.sources.reduce((sum,row)=>sum+Number(row.baseQuantity),0),10);
  const kit = r.sources.find(row=>row.sku==='HBCOMAX-K003S');
  assert.equal(kit.factor,'3');
  assert.equal(Number(kit.quantity),2);
  assert.equal(Number(kit.baseQuantity),6);
});

test('export, pagination and sorting share full ranking, with composition metadata and exact fractional conversion', async () => {
  const full = await report(composedFilters,-1);
  const small = await report(composedFilters,1);
  const sorted = await report(composedFilters,100,'revenue','asc');
  assert.deepEqual(small.rows,[full.rows[0]]);
  assert.deepEqual(sorted.rows.map(r=>[r.entityId,r.rank]).sort(),full.rows.map(r=>[r.entityId,r.rank]).sort());
  assert.ok(exportMetadata(composedFilters,full).some(row=>row[0]==='Composição · versão'&&row[1]===rules.version));
  const fractions = structuredClone(rules); fractions.rules['HBCOMAX-K003S'].factor='0.125';
  const r = await report({...composedFilters,selections:{skus:['HBCOMAX-K003S']}},50,'rank','asc',fractions);
  assert.equal(Number(r.quantity),0.25);
  assert.equal(r.revenue,'6000');
});

test('ABC classes and cumulative percentages are recalculated after consolidation for both metrics and classification modes', async () => {
  for(const metric of ['quantity','revenue'])for(const mode of ['TINY_LEGACY','STRICT_CUMULATIVE']) {
    const r=await report({...composedFilters,metric,mode,thresholdA:55,thresholdB:90},-1);
    const expected=rankABC(r.rows,metric,mode,55,90);
    assert.deepEqual(r.rows.map(row=>[row.entityId,row.rank,row.class]),expected.map(row=>[row.entityId,row.rank,row.class]));
    for(const row of r.rows)assert.ok(Math.abs(row.cumulative-expected.find(e=>e.entityId===row.entityId).cumulative)<0.00011);
    assert.equal(r.revenue,'14200');
  }
});

test('composition functions are read-only, browser-restricted and enforce membership', async () => {
  const privileges = await db.query(`SELECT p.proname,p.provolatile,has_function_privilege('authenticated',p.oid,'execute') browser,has_function_privilege('anon',p.oid,'execute') anonymous FROM pg_proc p WHERE proname IN ('analytics_composition_lines','analytics_abc_components_v16','analytics_drilldown_components_v16')`);
  assert.equal(privileges.rows.length,3);
  assert.ok(privileges.rows.every(row=>row.provolatile==='s'&&!row.browser&&!row.anonymous));
  await assert.rejects(report(composedFilters,50,'rank','asc',rules,'99999999-0000-4000-8000-000000000001'),/MEMBER_REQUIRED/);
  await db.exec('BEGIN TRANSACTION READ ONLY');
  try { assert.equal((await report()).revenue,'14200'); } finally { await db.exec('ROLLBACK'); }
});

test('mixed kits use verified stock units and column L reference costs', () => {
  assert.equal(rules.revenuePolicy,'cost');
  assert.equal(rules.costSource.column,'L');
  assert.equal(rules.referenceCosts['ACBF000-K050'],'500');
  assert.equal(rules.referenceCosts['ACTM001-K002'],'360');
  assert.equal(rules.referenceCosts['CMPO00B-K001'],'2345');
  assert.equal(rules.referenceCosts['CMPO00C-K001'],'2345');
  assert.deepEqual(rules.bundles['ACTM001-K052'].components.map(c=>[c.target,c.factor]),[['ACBF000-K050','1'],['ACTM001-K002','1']]);
  const missing=[...new Set(Object.values(rules.bundles).flatMap(b=>b.components.map(c=>c.target)).filter(sku=>!rules.referenceCosts[sku]))].sort();
  assert.deepEqual(missing,['ACFS000-K001']);
  assert.equal(Object.keys(rules.bundles).length,41);
});

test('nested mixed kits merge repeated leaves using exact decimal arithmetic',()=>{
  const r=buildCompositionRules([
    {sku:'A',name:'A',components:[{sku:'B',name:'B',quantity:'0.125'},{sku:'D',name:'D',quantity:'0.1'}]},
    {sku:'B',name:'B',components:[{sku:'C',name:'C',quantity:'2.4'},{sku:'D',name:'D',quantity:'1.2'},{sku:'C',name:'C',quantity:'0.8'}]},
  ],'nested');
  assert.deepEqual(r.bundles.A.components.map(c=>[c.target,c.factor]),[['C','0.4'],['D','0.25']]);
});

const companyThree={...composedFilters,selections:{companies:[connections[2]]}};
async function fixture(items, action) {
  await db.exec('BEGIN');
  try {await sale(connections[2],items);await action();} finally {await db.exec('ROLLBACK');}
}
test('tape plus silicone pair and Ponds combo conserve cents, quantities and distinct orders',async()=>{
  await fixture([
    {product:401,sku:'ACTM001-K052',qty:2,cents:10001},
    {product:402,sku:'ACTM001-K002',qty:1,cents:500},
    {product:403,sku:'CMPO0BC-K002',qty:1,cents:2001},
    {product:404,sku:'HBCOMAX-K003',qty:1,cents:900},
  ],async()=>{
    const r=await report(companyThree), row=sku=>r.rows.find(row=>row.sku===sku);
    assert.equal(r.revenue,'13402');assert.equal(r.composition.originalRevenue,r.revenue);
    assert.equal(r.orders,1);assert.equal(r.total,5);assert.equal(Number(r.quantity),10);
    assert.equal(row('ACBF000-K050').revenue,'5815');assert.equal(Number(row('ACBF000-K050').quantity),2);
    assert.equal(row('ACTM001-K002').revenue,'4686');assert.equal(Number(row('ACTM001-K002').quantity),3);
    assert.equal(row('ACTM001-K002').orders,1);
    assert.equal(row('CMPO00B-K001').revenue,'1001');assert.equal(row('CMPO00C-K001').revenue,'1000');
    assert.equal(Number(row('HBCOMAX-K001').quantity),3);
    const drill=(await db.query('SELECT analytics_drilldown_components_v16($1,$2,$3,$4,$5) result',[ws,ws,JSON.stringify(companyThree),JSON.stringify(rules),'composition:ACTM001-K002'])).rows[0].result;
    const kit=drill.sources.find(s=>s.sku==='ACTM001-K052');
    assert.equal(kit.revenue,'4186');assert.equal(kit.originalRevenue,'10001');assert.equal(kit.referenceCostCents,'360');
    assert.equal(drill.total,1);assert.equal(drill.orders[0].revenue,'4686');
    const original=await query(db,{...companyThree,grouping:'product'});
    assert.equal(original.revenue,r.revenue);assert.equal(Number(original.quantity),5);
  });
});

test('each original line allocates its own remaining cents even for duplicate kit SKUs in one order',async()=>{
  await fixture([{product:401,sku:'ACTM001-K052',qty:1,cents:1},{product:401,sku:'ACTM001-K052',qty:1,cents:1}],async()=>{
    const r=await report(companyThree);
    assert.equal(r.revenue,'2');assert.equal(r.orders,1);assert.equal(Number(r.quantity),4);
    assert.equal(r.rows.find(row=>row.sku==='ACBF000-K050').revenue,'2');
    assert.equal(r.rows.find(row=>row.sku==='ACTM001-K002').revenue,'0');
    assert.equal(r.composition.mixedLines,2);
  });
});

test('CMV weights include component quantities rather than only comparing unit costs',async()=>{
  await fixture([{product:401,sku:'ACTM001-K052',qty:3,cents:10001}],async()=>{
    const weighted=structuredClone(rules);weighted.bundles['ACTM001-K052'].components[0].factor='2';
    const r=await report(companyThree,-1,'rank','asc',weighted);
    const tape=r.rows.find(row=>row.sku==='ACBF000-K050'),silicone=r.rows.find(row=>row.sku==='ACTM001-K002');
    assert.equal(tape.revenue,'7354');assert.equal(silicone.revenue,'2647');
    assert.equal(Number(tape.quantity),6);assert.equal(Number(silicone.quantity),3);
    assert.equal(r.revenue,'10001');
  });
});

test('only explicitly approved unlinked SKUs consolidate, preserving values, filters and source traceability',async()=>{
  assert.deepEqual(Object.keys(rules.unlinkedRules).sort(),['2165','ACBF000-K050E','CMNV150-K002','CMNV150-K003']);
  assert.equal(rules.unlinkedRules['CMNV150-K001'],undefined);
  assert.equal(rules.unlinkedRules['HBCOMAX-K001S'],undefined);
  await fixture([
    {sku:'CMNV150-K002',qty:3,cents:6000,unlinked:true},
    {sku:'2165',qty:2,cents:2000,unlinked:true},
    {product:501,sku:'CMNV150-K001',qty:1,cents:1000},
    {product:502,sku:'CMNV150-K002',qty:1,cents:2000},
    {sku:'HBCOMAX-K001S',qty:1,cents:100,unlinked:true},
  ],async()=>{
    const r=await report(companyThree), raw=await query(db,{...companyThree,grouping:'product'});
    assert.equal(r.revenue,'11100');assert.equal(r.revenue,raw.revenue);
    assert.equal(r.orders,1);assert.equal(r.total,3);assert.equal(Number(r.quantity),12);
    const nivea=r.rows.find(row=>row.sku==='CMNV150-K001'), colbert=r.rows.find(row=>row.sku==='DDCO00N-K001');
    assert.equal(Number(nivea.quantity),9);assert.equal(nivea.revenue,'9000');assert.equal(nivea.orders,1);
    assert.equal(Number(colbert.quantity),2);assert.equal(colbert.revenue,'2000');
    assert.ok(r.rows.some(row=>row.sku==='HBCOMAX-K001S'&&row.entityId.includes(':order:')));
    assert.ok(raw.rows.some(row=>row.sku==='2165'&&row.entityId.includes(':order:')));
    const f={...companyThree,selections:{...companyThree.selections,skus:['CMNV150-K002']}};
    const selected=await report(f);assert.equal(selected.total,1);assert.equal(Number(selected.quantity),8);assert.equal(selected.revenue,'8000');
    const drill=(await db.query('SELECT analytics_drilldown_components_v16($1,$2,$3,$4,$5) result',[ws,ws,JSON.stringify(companyThree),JSON.stringify(rules),nivea.entityId])).rows[0].result;
    assert.equal(drill.sources.find(s=>s.sku==='CMNV150-K002').factor,'2');
    assert.equal(drill.sources.find(s=>s.sku==='CMNV150-K002').revenue,'8000');
    assert.equal(drill.sources.reduce((sum,s)=>sum+Number(s.baseQuantity),0),9);
    const denied=structuredClone(rules);denied.unlinkedRules={};
    const safe=await report(companyThree,-1,'rank','asc',denied);
    assert.equal(safe.rows.filter(row=>row.entityId.includes(':order:')).length,3);
    assert.equal(safe.revenue,r.revenue);
  });
});

test('confirmed unlinked Nivea three-pack and packaged tape preserve sale values, base units and traceability in v21',async()=>{
  // Migrations contain COMMIT; use a separate database so legacy fixtures stay isolated.
  const confirmationDb=await isolatedDatabase();
  try{
    for(const file of ['migration_v14_v15_analytics_complete.sql','migration_v16_analytics_confirmed_unlinked.sql','migration_v18_analytics_olist_costs.sql','migration_v19_analytics_cost_effective_dates.sql','migration_v20_analytics_signed_item_amounts.sql','migration_v21_analytics_zero_signed_costs.sql'])
      await confirmationDb.exec(readFileSync(`supabase/${file}`,'utf8'));
    const connection=connections[2];
    const order=(await confirmationDb.query(`INSERT INTO analytics_orders(workspace_id,company_id,connection_id,source_id,canonical_key,external_id,customer_key,customer_name,sale_date,status,total_cents,fetched_at)
      VALUES($1,$2,$2,$2,'confirmed-kits','confirmed-kits','customer','Cliente','2026-09-10',1,17849,now()) RETURNING id`,[ws,connection])).rows[0].id;
    for(const [position,sku,cents]of [[0,'CMNV150-K003',14600],[1,'ACBF000-K050E',3249]]){
      const product=`order:confirmed-kits:item:${position}`;
      await confirmationDb.query('INSERT INTO analytics_products(workspace_id,connection_id,external_id,sku,name) VALUES($1,$2,$3,$4,$4)',[ws,connection,product,sku]);
      await confirmationDb.query('INSERT INTO analytics_items(workspace_id,order_id,position,connection_id,product_id,quantity,unit_price,gross_cents) VALUES($1,$2,$3,$4,$5,1,1,$6)',[ws,order,position,connection,product,cents]);
    }
    const approved=compositionRulesForWorkspace(catalog.workspaceIds[0]);
    const currentReport=async f=>(await confirmationDb.query('SELECT analytics_abc_components_v21($1,$2,$3,$4) result',[ws,ws,JSON.stringify(f),JSON.stringify(approved)])).rows[0].result;
    const result=await currentReport(companyThree);
    assert.equal(result.total,2);assert.equal(result.orders,1);
    assert.equal(result.revenue,'17849');assert.equal(result.composition.originalRevenue,'17849');
    assert.equal(Number(result.quantity),4);assert.equal(result.composition.unallocatedLines,0);
    assert.equal(result.composition.pendingTotal,0);
    assert.ok(result.rows.every(row=>row.entityId==='composition:'+row.sku));
    const raw=await query(confirmationDb,{...companyThree,grouping:'product'});
    assert.equal(raw.revenue,result.revenue);
    assert.deepEqual(raw.rows.map(row=>row.sku).sort(),['ACBF000-K050E','CMNV150-K003']);
    assert.ok(raw.rows.every(row=>row.entityId.includes(':order:')));
    for(const [source,target,quantity,revenue]of [
      ['CMNV150-K003','CMNV150-K001',3,'14600'],
      ['ACBF000-K050E','ACBF000-K050',1,'3249'],
    ]){
      const row=result.rows.find(item=>item.sku===target);
      assert.equal(Number(row.quantity),quantity);assert.equal(row.revenue,revenue);
      const selected=await currentReport({...companyThree,selections:{...companyThree.selections,skus:[source]}});
      assert.equal(selected.total,1);assert.equal(Number(selected.quantity),quantity);assert.equal(selected.revenue,revenue);
      const detail=(await confirmationDb.query('SELECT analytics_drilldown_components_v21($1,$2,$3,$4,$5) result',[ws,ws,JSON.stringify(companyThree),JSON.stringify(approved),row.entityId])).rows[0].result;
      assert.equal(detail.sources.length,1);assert.equal(detail.sources[0].sku,source);
      assert.equal(Number(detail.sources[0].quantity),1);assert.equal(Number(detail.sources[0].baseQuantity),quantity);
      assert.equal(detail.sources[0].factor,String(quantity));assert.equal(detail.sources[0].revenue,revenue);
      if(source==='ACBF000-K050E')assert.deepEqual(detail.sources[0].ignoredComponents,['EBBF001-001']);
    }
    assert.equal(result.rows.some(row=>row.sku==='EBBF001-001'),false);
  }finally{await confirmationDb.close();}
});

test('missing or invalid CMV blocks value classification and preserves quantity analysis with explicit unallocated amounts',async()=>{
  await fixture([{product:401,sku:'ACTM001-K052',qty:2,cents:10001}],async()=>{
    for(const cost of [undefined,'0','-360','NaN']) {
      const incomplete=structuredClone(rules);incomplete.referenceCosts['ACTM001-K002']=cost;
      await db.exec('SAVEPOINT missing_cost');
      await assert.rejects(report(companyThree,50,'rank','asc',incomplete),/CMV_REQUIRED:ACTM001-K002/);
      await db.exec('ROLLBACK TO SAVEPOINT missing_cost');
      const f={...companyThree,metric:'quantity'}, r=await report(f,-1,'rank','asc',incomplete);
      assert.equal(Number(r.quantity),4);assert.equal(r.orders,1);assert.equal(r.revenue,'0');
      assert.equal(r.composition.originalRevenue,'10001');assert.equal(r.composition.unallocatedRevenue,'10001');
      assert.equal(r.composition.unallocatedLines,1);assert.deepEqual(r.composition.missingCostSkus,['ACTM001-K002']);
      assert.ok(exportMetadata(f,r).some(([key,value])=>key.endsWith('CMV pendente')&&value==='ACTM001-K002'));
      assert.ok(exportMetadata(f,r).some(([key,value])=>key.endsWith('valor sem rateio (centavos)')&&value==='10001'));
    }
  });
});

test('zero-value mixed lines conserve zero without requiring artificial CMV',async()=>{
  await fixture([{product:401,sku:'ACTM001-K052',qty:2,cents:0}],async()=>{
    const incomplete=structuredClone(rules);delete incomplete.referenceCosts['ACTM001-K002'];
    const r=await report(companyThree,-1,'rank','asc',incomplete);
    assert.equal(r.revenue,'0');assert.equal(r.composition.unallocatedLines,0);assert.equal(Number(r.quantity),4);
    assert.ok(r.rows.every(row=>row.class==='C'&&row.cumulative===0));
  });
});

test('allocation uses exact integer quotients for huge weights and stable SKU ties for equal remainders',async()=>{
  await fixture([{product:401,sku:'ACTM001-K052',qty:1,cents:10001}],async()=>{
    const exact=structuredClone(rules);
    exact.referenceCosts['ACBF000-K050']='100000000000000000000000000000000000000000000000001';
    exact.referenceCosts['ACTM001-K002']='100000000000000000000000000000000000000000000000000';
    const r=await report(companyThree,-1,'rank','asc',exact);
    assert.equal(r.rows.find(row=>row.sku==='ACBF000-K050').revenue,'5001');
    assert.equal(r.rows.find(row=>row.sku==='ACTM001-K002').revenue,'5000');
    assert.equal(r.revenue,'10001');
    exact.referenceCosts['ACBF000-K050']='360';exact.referenceCosts['ACTM001-K002']='360';
    assert.deepEqual((await report(companyThree,-1,'rank','asc',exact)).rows.map(row=>[row.sku,row.revenue]),r.rows.map(row=>[row.sku,row.revenue]));
  });
});
