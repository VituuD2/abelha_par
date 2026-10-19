require('./setup.cjs');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { isolatedDatabase, ws, connections, filters, query } = require('../scripts/analytics-isolated.cjs');
const { rankABC } = require('../src/lib/analytics/engine.ts');
const { normalizeOrder } = require('../src/lib/analytics/normalize.ts');
const admin = require('../src/lib/supabase/admin.ts');
const access = require('../src/lib/access.ts');
const server = require('../src/lib/analytics/server.ts');
const abc = require('../src/app/api/analytics/abc/route.ts');
const exportApi = require('../src/app/api/analytics/export/route.ts');
let db;
before(async () => { db = await isolatedDatabase(); });
after(async () => { await db?.close(); });

// Independent rational oracle: no production ranking/decimal helpers, no percentages
// rounded before classification. Fixtures explicitly carry integer micro-quantities.
function oracle(input, mode, metric, a, b) {
  const ranked = [...input].sort((x, y) => {
    const vx = BigInt(x[metric]), vy = BigInt(y[metric]);
    return vx !== vy ? (vx > vy ? -1 : 1) : BigInt(x.q) !== BigInt(y.q)
      ? (BigInt(x.q) > BigInt(y.q) ? -1 : 1) : x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  const total = ranked.reduce((s, r) => s + BigInt(r[metric]), 0n);
  let cumulative = 0n;
  return ranked.map((r, i) => {
    const previous = cumulative;
    cumulative += BigInt(r[metric]);
    const boundary = mode === 'TINY_LEGACY' ? previous : cumulative;
    return { id: r.id, rank: i + 1, class: !total ? 'C' : boundary * 10000n < total * BigInt(Math.round(a * 100)) ? 'A' : boundary * 10000n < total * BigInt(Math.round(b * 100)) ? 'B' : 'C',
      cumulative: total ? Number(cumulative * 1000000n / total) / 10000 : 0 };
  });
}
test('independent mathematical oracle agrees with SQL and TS across edge cases, metrics, ties, limits, paging and visual sort', async () => {
  const cases = [[], ['0'], ['100'], ['9968','32'], ['80','15','5'], Array(40).fill('1'), ['900719925474099399','1500','0']];
  for (const values of cases) {
    await db.exec('BEGIN');
    try {
      const c = connections[0];
      const inputs = values.map((v, i) => ({ id: c + ':' + (i + 1), revenue: v, q: String((i % 3 + 1) * 125000) }));
      for (const [i, r] of inputs.entries()) {
        const oid = '33000000-0000-4000-8000-' + String(i + 1).padStart(12,'0');
        await db.query('INSERT INTO analytics_products(workspace_id,connection_id,external_id,name) VALUES($1,$2,$3,$3)', [ws, c, String(i + 1)]);
        await db.query("INSERT INTO analytics_orders(id,workspace_id,company_id,connection_id,source_id,canonical_key,external_id,customer_key,customer_name,sale_date,status,total_cents,fetched_at) VALUES($1,$2,$3,$3,$3,$4,$4,'c','c','2026-09-01',1,$5,now())", [oid, ws, c, String(i + 1), r.revenue]);
        await db.query('INSERT INTO analytics_items VALUES($1,$2,0,$3,$4,$5,1,$6)', [ws, oid, c, String(i + 1), String(Number(r.q) / 1000000), r.revenue]);
      }
      for (const mode of ['TINY_LEGACY','STRICT_CUMULATIVE']) for (const metric of ['revenue','quantity']) for (const [a,b] of [[80,95],[65.25,90.75]]) {
        const f = { ...filters, mode, metric, thresholdA:a, thresholdB:b };
        const expected = oracle(inputs, mode, metric === 'quantity' ? 'q' : 'revenue', a,b);
        const actual = await query(db, f, 0, -1);
        const ts = rankABC(inputs.map(r => ({ entityId:r.id,name:r.id,sku:'',revenue:r.revenue,quantity:String(Number(r.q)/1000000),orders:1 })), metric, mode,a,b);
        for (const candidate of [actual.rows, ts]) {
          assert.deepEqual(candidate.map(r => ({id:r.entityId,rank:r.rank,class:r.class})), expected.map(({cumulative,...rest})=>rest));
          candidate.forEach((r,i) => assert.ok(Math.abs(r.cumulative - expected[i].cumulative) < 0.00011));
        }
        const paged = await query(db, f, 1,25,'name','desc');
        paged.rows.forEach(r => assert.equal(r.class, expected.find(x=>x.id===r.entityId).class));
      }
    } finally { await db.exec('ROLLBACK'); }
  }
});

test('unlinked order lines reconcile exactly through normalized payload, SQL ingest, report API, CSV and XLSX; all company combinations isolate correctly', async t => {
  const totals = [1234n,2500n,3600n];
  for (const [i,c] of connections.entries()) {
    await db.query("INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date) VALUES($1,$2,'backfill','2026-09-01','2026-09-01','2026-09-01')", [ws,c]);
    const job = (await db.query('SELECT * FROM analytics_claim_job($1)', [ws])).rows[0];
    assert.equal(job.connection_id,c);
    const raw = { id: 77, situacao:1,data:'2026-09-01',itens:[{produto:{id:0,sku:'=DANGEROUS',descricao:'=FORMULA'},quantidade:1,valorUnitario:String(Number(totals[i])/100)}] };
    const normalized = normalizeOrder(raw,c,c,new Date().toISOString());
    for (let n=0;n<2;n++) await db.query('SELECT analytics_ingest($1,$2,$3,$4)', [job.id,job.lease_token,JSON.stringify(normalized.order),JSON.stringify(normalized.items)]);
    await db.query("UPDATE analytics_sync_jobs SET status='completed',lease_token=null,lease_until=null WHERE id=$1", [job.id]);
    await db.query('UPDATE analytics_connections SET sync_lock=null,sync_locked_until=null WHERE id=$1', [c]);
  }
  for (const indices of [[0,1,2],[0],[1],[2],[0,2],[0,1]]) {
    const f = {...filters,selections:{...filters.selections,companies:indices.map(i=>connections[i])}};
    const r = await query(db,f);
    assert.equal(r.revenue,indices.reduce((s,i)=>s+totals[i],0n).toString());
    assert.equal(r.orders,indices.length);
    assert.equal(r.rows.length,indices.length);
  }
  t.mock.method(access,'authorize',async()=>({access:{workspaceId:ws,user:{id:ws},role:'operator'}}));
  t.mock.method(admin,'createAdminClient',()=>({rpc:async(name,p)=> {
    assert.equal(name,'analytics_abc');
    return {data:await query(db,p.p_filters,p.p_offset,p.p_limit,p.p_sort,p.p_direction),error:null};
  }}));
  t.mock.method(server,'analyticsStatus',async()=>({companies:connections.map((c,i)=>({id:c,name:'Olist '+(i+1)})),connections:connections.map(c=>({id:c,company_id:c,name:c,enabled:true})),jobs:[],coverage:[]}));
  const request = body => new Request('http://isolated/api/analytics/abc',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const f={...filters,selections:{companies:[connections[0],connections[2]]}};
  const response = await abc.POST(request({filters:f,size:25,ensureCoverage:false,workspaceId:'forged'}));
  assert.equal(response.status,200);
  assert.equal((await response.json()).revenue,'4834');
  const csv = await exportApi.POST(request({filters:f,format:'csv'}));
  assert.equal(csv.status,200);
  const text=await csv.text();
  assert.match(text,/provisória/); assert.match(text,/'=FORMULA/);
  assert.match(text,/12\.34/); assert.match(text,/36\.00/); assert.doesNotMatch(text,/25\.00/);
  const xlsx = await exportApi.POST(request({filters:f,format:'xlsx'}));
  assert.equal(xlsx.status,200);
  const XLSX=require('xlsx');
  const book=XLSX.read(Buffer.from(await xlsx.arrayBuffer()),{type:'buffer'});
  assert.equal(book.Sheets['Curva ABC'].B2.t,'s');
  assert.equal(book.Sheets['Curva ABC'].B2.f,undefined);
  assert.equal(XLSX.utils.sheet_to_json(book.Sheets['Curva ABC']).length,2);
});
