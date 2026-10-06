const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { PGlite } = require("@electric-sql/pglite");
require("./setup.cjs");
const { rankABC } = require("../src/lib/analytics/engine.ts");
const db = new PGlite();
const ws = "11000000-0000-4000-8000-000000000001",
  operator = "11000000-0000-4000-8000-000000000002",
  foreign = "11000000-0000-4000-8000-000000000003";
const conn1 = "22000000-0000-4000-8000-000000000001",
  conn2 = "22000000-0000-4000-8000-000000000002",
  conn3 = "22000000-0000-4000-8000-000000000003";
const filters = {
  from: "2026-09-01",
  to: "2026-09-30",
  metric: "revenue",
  mode: "TINY_LEGACY",
  grouping: "product",
  basis: "orders",
  thresholdA: 80,
  thresholdB: 95,
  selections: { statuses: ["1", "5", "6"] },
};
const sql = (file) =>
  readFileSync(join(__dirname, "../supabase", file), "utf8");
const query = async (
  f = filters,
  limit = 50,
  sort = "rank",
  direction = "asc",
  actor = operator,
) =>
  (
    await db.query("SELECT analytics_abc($1,$2,$3,0,$4,$5,$6) result", [
      ws,
      actor,
      JSON.stringify(f),
      limit,
      sort,
      direction,
    ])
  ).rows[0].result;
let job, source1, source2, source3;
async function expectDbError(action, pattern) {
  await db.exec("SAVEPOINT expected_error");
  await assert.rejects(action(),pattern);
  await db.exec("ROLLBACK TO SAVEPOINT expected_error; RELEASE SAVEPOINT expected_error");
}
before(async () => {
  await db.exec(
    `CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz DEFAULT now(),raw_user_meta_data jsonb DEFAULT '{}');CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`,
  );
  for (const file of [
    "migration.sql",
    "migration_v2.sql",
    "migration_v3_security.sql",
    "migration_v4_incremental_olist_sync.sql",
    "migration_v5_batch_responsible.sql",
    "migration_v6_nuvemshop_sessions.sql",
    "migration_v7_olist_queue.sql",
    "migration_v8_olist_token_refresh.sql",
  ])
    await db.exec(sql(file));
  await db.query("INSERT INTO auth.users(id) VALUES($1),($2)", [ws, operator]);
  await db.query(
    "INSERT INTO tiny_integrations(owner_id,access_token,refresh_token,expires_at) VALUES($1,'secret-access','secret-refresh',now()+interval '4 hours')",
    [ws],
  );
  await db.exec(sql("migration_v9_ninho_workspaces.sql"));
  await db.exec(sql("migration_v10_atomic_scan.sql"));
  await db.query("INSERT INTO auth.users(id) VALUES($1)", [foreign]);
  await db.query("INSERT INTO workspaces(id) VALUES($1)", [foreign]);
  await db.query(
    "INSERT INTO workspace_members(user_id,workspace_id,role) VALUES($1,$1,'admin')",
    [foreign],
  );
  await db.exec(sql("migration_v11_analytics_abc.sql"));
  await db.exec(sql("migration_v11_analytics_abc.sql"));
  await db.exec(sql("migration_v12_analytics_automation.sql"));
  await db.exec(sql("migration_v12_analytics_automation.sql"));
  for (const [i, c] of [conn1, conn2, conn3].entries()) {
    await db.query(
      "INSERT INTO analytics_companies(id,workspace_id,name) VALUES($1,$2,$3)",
      [c, ws, "Empresa " + (i + 1)],
    );
    await db.query(
      "INSERT INTO analytics_connections(id,workspace_id,company_id,name) VALUES($1,$2,$1,$3)",
      [c, ws, "Olist " + (i + 1)],
    );
  }
  source1 = (
    await db.query(
      "INSERT INTO analytics_sources(workspace_id,connection_id,external_id,name,channel,kind,marketplace) VALUES($1,$2,'10','Canal A','Canal A','marketplace','Mercado observado') RETURNING id",
      [ws, conn1],
    )
  ).rows[0].id;
  source2 = (
    await db.query(
      "INSERT INTO analytics_sources(workspace_id,connection_id,external_id,name,kind,store) VALUES($1,$2,'11','Site real','site','Site real') RETURNING id",
      [ws, conn2],
    )
  ).rows[0].id;
  source3 = (
    await db.query(
      "INSERT INTO analytics_sources(workspace_id,connection_id,external_id,name,channel,kind,marketplace) VALUES($1,$2,'12','Canal A','Canal A','marketplace','Mercado observado') RETURNING id",
      [ws, conn3],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date) VALUES($1,$2,'backfill','2026-09-01','2026-09-30','2026-09-01')",
    [ws, conn1],
  );
  job = (await db.query("SELECT * FROM analytics_claim_job($1)", [ws])).rows[0];
});
after(() => db.close());
async function ingest(
  connection,
  source,
  external,
  value,
  product = "7",
  parent = null,
  status = 1,
) {
  let j = job;
  if (connection !== conn1) {
    await db.query(
      "INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date) VALUES($1,$2,'backfill','2026-09-01','2026-09-30','2026-09-01') ON CONFLICT DO NOTHING",
      [ws, connection],
    );
    const prior = (
      await db.query(
        "SELECT * FROM analytics_sync_jobs WHERE connection_id=$1 AND status='running'",
        [connection],
      )
    ).rows[0];
    j =
      prior ||
      (await db.query("SELECT * FROM analytics_claim_job($1)", [ws])).rows[0];
  }
  const order = {
    source_id: source,
    external_id: external,
    number: external,
    external_reference: "EXT-" + external,
    customer_key: connection + ":customer:8",
    customer_name: "Cliente",
    sale_date: "2026-09-10",
    status,
    total_cents: String(value),
    discount_cents: "0",
    fetched_at: new Date().toISOString(),
    tags: ["tag"],
    state: "SP",
    seller: "Vendedor",
    nature: "Venda",
  };
  const items = [
    {
      position: 0,
      product_id: product,
      sku: "SKU-IGUAL",
      name: "Produto " + product,
      parent_id: parent,
      parent_name: parent ? "Produto pai" : null,
      quantity: "1",
      unit_price: String(value / 100),
      gross_cents: String(value),
      category: "Categoria",
      brand: "Marca",
    },
  ];
  return (
    await db.query("SELECT analytics_ingest($1,$2,$3,$4) id", [
      j.id,
      j.lease_token,
      JSON.stringify(order),
      JSON.stringify(items),
    ])
  ).rows[0].id;
}
test("migration is idempotent, links legacy credentials without changing scanner and restricts browser access", async () => {
  assert.equal(
    (await db.query("SELECT access_token FROM tiny_integrations")).rows[0]
      .access_token,
    "secret-access",
  );
  const linked = (
    await db.query(
      "SELECT * FROM analytics_connections WHERE credential_kind='legacy'",
    )
  ).rows;
  assert.equal(linked.length, 1);
  assert.equal(linked[0].access_token, null);
  for (const role of ["anon", "authenticated"])
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege($1,'analytics_connections','SELECT') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  assert.equal(
    (
      await db.query(
        "SELECT has_function_privilege('authenticated','analytics_abc(uuid,uuid,jsonb,integer,integer,text,text)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
});
test("group setup is scoped, repeatable, creates pending accounts and never fabricates authorizations", async () => {
  const setup = sql("setup_analytics_grupo_multiempresas.sql")
    .replaceAll("REPLACE_WITH_AUTHORIZED_WORKSPACE_UUID", ws)
    .replace(/^BEGIN;$/gm, "")
    .replace(/^COMMIT;$/gm, "");
  await db.exec("BEGIN");
  try {
    await db.exec(setup);
    await db.exec(setup);
    const companies = (
      await db.query(
        "SELECT tax_id FROM analytics_companies WHERE workspace_id=$1 AND tax_id IS NOT NULL ORDER BY tax_id",
        [ws],
      )
    ).rows;
    assert.deepEqual(
      companies.map((c) => c.tax_id),
      ["13397731000164", "36965322000112", "37201039000187"],
    );
    const pending = (
      await db.query(
        "SELECT enabled,access_token,client_secret,verified_tax_id FROM analytics_connections WHERE workspace_id=$1 AND name IN ('Olist 1','Olist 3') AND company_id NOT IN ($2,$3)",
        [ws, conn1, conn3],
      )
    ).rows;
    assert.equal(pending.length, 2);
    assert.ok(
      pending.every(
        (c) =>
          !c.enabled &&
          !c.access_token &&
          !c.client_secret &&
          !c.verified_tax_id,
      ),
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*) n FROM analytics_companies WHERE workspace_id=$1",
          [foreign],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await db.exec("ROLLBACK");
  }
});
test("idempotent imports replace changed items, stale lease fails, per-account lease serializes", async () => {
  const first = await ingest(conn1, source1, "1", 8000);
  assert.equal(await ingest(conn1, source1, "1", 8000), first);
  assert.equal((await query()).revenue, "8000");
  assert.equal(
    (await db.query("SELECT * FROM analytics_claim_job($1)", [ws])).rows.length,
    0,
  );
  await assert.rejects(
    db.query("SELECT analytics_ingest($1,$2,$3,$4)", [
      job.id,
      conn2,
      "{}",
      "[]",
    ]),
    /LEASE_LOST/,
  );
  await ingest(conn1, source1, "1", 7900);
  assert.equal((await query()).revenue, "7900");
  await ingest(conn1, source1, "1", 8000);
  await ingest(conn1, source1, "2", 1500, "8", "9");
  await ingest(conn1, source1, "3", 500, "10", "9");
  await ingest(conn1, source1, "4", 50000, "11", null, 2);
});
test("SQL math matches engine for modes, metrics and sorting without changing rank; cancellation is excluded", async () => {
  for (const mode of ["TINY_LEGACY", "STRICT_CUMULATIVE"])
    for (const metric of ["revenue", "quantity"]) {
      const actual = await query({ ...filters, mode, metric });
      const expected = rankABC(
        actual.rows.map((r) => ({ ...r, rank: undefined })),
        metric,
        mode,
      );
      assert.deepEqual(
        actual.rows.map((r) => [r.entityId, r.class, r.rank]),
        expected.map((r) => [r.entityId, r.class, r.rank]),
      );
      actual.rows.forEach((r, i) =>
        assert.ok(
          Math.abs(Number(r.cumulative) - expected[i].cumulative) < 0.00011,
        ),
      );
    }
  assert.equal((await query()).revenue, "10000");
  const desc = await query(filters, 50, "name", "desc");
  assert.equal(desc.rows.find((r) => r.revenue === "8000").rank, 1);
  const parent = await query({ ...filters, grouping: "parent" });
  assert.equal(parent.total, 2);
  assert.equal(
    parent.rows.find((r) => r.entityId.endsWith(":9")).revenue,
    "2000",
  );
  const customers = await query({ ...filters, grouping: "customer" });
  assert.equal(customers.total, 1);
  assert.equal(customers.orders, 3);
});
test("omnichannel consolidation scopes same SKUs by company and supports arbitrary company/source combinations", async () => {
  await ingest(conn2, source2, "1", 2000);
  await ingest(conn3, source3, "1", 3000);
  const all = await query();
  assert.equal(all.revenue, "15000");
  assert.equal(all.total, 5);
  const oneAndThree = await query({
    ...filters,
    selections: { ...filters.selections, companies: [conn1, conn3] },
  });
  assert.equal(oneAndThree.revenue, "13000");
  const channel = await query({
    ...filters,
    selections: { ...filters.selections, marketplaces: ["Mercado observado"] },
  });
  assert.equal(channel.revenue, "13000");
  const two = await query({
    ...filters,
    selections: {
      ...filters.selections,
      companies: [conn2],
      stores: ["Site real"],
    },
  });
  assert.equal(two.revenue, "2000");
  const both = await query({
    ...filters,
    selections: {
      ...filters.selections,
      companies: [conn3],
      channels: ["Canal A"],
      tags: ["tag"],
      states: ["SP"],
      brands: ["Marca"],
    },
  });
  assert.equal(both.revenue, "3000");
  const empty = await query({
    ...filters,
    selections: { companies: [foreign] },
  });
  assert.equal(empty.total, 0);
  const options = (
    await db.query("SELECT analytics_options($1,$2) result", [ws, operator])
  ).rows[0].result;
  assert.equal(options.marketplaces[0].value, "Mercado observado");
  assert.equal(options.connections.length, 4);
});
test("exports return all ranked entities and drilldown reuses the exact filtered scope", async () => {
  const all = await query(filters, -1);
  assert.equal(all.rows.length, all.total);
  const drill = (
    await db.query("SELECT analytics_drilldown($1,$2,$3,$4,0) result", [
      ws,
      operator,
      JSON.stringify(filters),
      conn1 + ":7",
    ])
  ).rows[0].result;
  assert.equal(drill.total, 1);
  assert.equal(drill.companies[0].name, "Empresa 1");
  assert.equal(drill.orders[0].connection, "Olist 1");
});
test("foreign admins and inactive users cannot query; RLS and compound FKs prevent workspace mixing", async () => {
  await assert.rejects(
    query(filters, 50, "rank", "asc", foreign),
    /MEMBER_REQUIRED/,
  );
  await db.query("UPDATE workspace_members SET active=false WHERE user_id=$1", [
    operator,
  ]);
  await assert.rejects(query(), /MEMBER_REQUIRED/);
  await db.query("UPDATE workspace_members SET active=true WHERE user_id=$1", [
    operator,
  ]);
  const visible = async (actor) =>
    db.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE authenticated");
      await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [
        actor,
      ]);
      return (await tx.query("SELECT id FROM analytics_orders")).rows.length;
    });
  assert.equal(await visible(foreign), 0);
  assert.ok((await visible(operator)) > 0);
  await assert.rejects(
    db.query(
      "INSERT INTO analytics_connections(workspace_id,company_id,name) VALUES($1,$2,'Bad')",
      [foreign, conn1],
    ),
    /foreign key/,
  );
});
test("explicit verified external-account mapping reconciles duplicate sales and preserves aliases on later imports", async () => {
  await assert.rejects(
    db.query(
      "SELECT analytics_reconcile_source($1,$2,$3,'marketplace','Mercado observado','','same-account')",
      [ws, operator, source1],
    ),
    /ADMIN_REQUIRED/,
  );
  await db.query(
    "SELECT analytics_reconcile_source($1,$2,$3,'marketplace','Mercado observado','','same-account')",
    [ws, ws, source1],
  );
  const merged = (
    await db.query(
      "SELECT analytics_reconcile_source($1,$2,$3,'marketplace','Mercado observado','','same-account') merged",
      [ws, ws, source3],
    )
  ).rows[0].merged;
  assert.equal(merged, 1);
  assert.equal((await query()).revenue, "12000");
  const aliases = (
    await db.query(
      "SELECT order_id FROM analytics_order_aliases WHERE external_id='1' AND connection_id IN ($1,$2)",
      [conn1, conn3],
    )
  ).rows;
  assert.equal(aliases.length, 2);
  assert.equal(aliases[0].order_id, aliases[1].order_id);
  await ingest(conn3, source3, "1", 3000);
  assert.equal((await query()).revenue, "12000");
});
test("cancellation updates existing sales even without item payloads and rejects stale leases", async () => {
  await db.query("SELECT analytics_cancel_order($1,$2,$3,now())", [
    job.id,
    job.lease_token,
    "2",
  ]);
  const result = await query();
  assert.equal(result.revenue, "10500");
  assert.ok(!result.rows.some((r) => r.entityId === conn1 + ":8"));
  await assert.rejects(
    db.query("SELECT analytics_cancel_order($1,$2,$3,now())", [
      job.id,
      conn2,
      "1",
    ]),
    /LEASE_LOST/,
  );
});
test("coverage merges completed intervals independently of recent incremental job history", async () => {
  await db.query(
    "INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,status) VALUES($1,$2,'backfill','2026-01-01','2026-01-15','2026-01-15','completed'),($1,$2,'backfill','2026-01-16','2026-01-31','2026-01-31','completed'),($1,$2,'backfill','2026-02-02','2026-02-05','2026-02-05','completed')",
    [ws, conn1],
  );
  const ranges = (
    await db.query("SELECT analytics_coverage($1,$2) coverage", [ws, operator])
  ).rows[0].coverage;
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].from_date, "2026-01-01");
  assert.equal(ranges[0].to_date, "2026-01-31");
  assert.equal(ranges[1].from_date, "2026-02-02");
});
test("missing-history scheduling subtracts covered and reserved spans, retains failed checkpoints and validates member scope", async () => {
  await db.exec("BEGIN");
  try {
    const c = "33000000-0000-4000-8000-000000000001";
    await db.query("INSERT INTO analytics_connections(id,workspace_id,company_id,name) VALUES($1,$2,$3,'Automation')", [c,ws,conn1]);
    for (const [a,b,status] of [["01","05","completed"],["10","15","queued"],["20","22","failed"]])
      await db.query("INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,status) VALUES($1,$2,'backfill',$3,$4,$3,$5)", [ws,c,`2026-08-${a}`,`2026-08-${b}`,status]);
    const f = { ...filters, from:"2026-08-01",to:"2026-08-31",selections:{connections:[c],companies:[conn1]} };
    const schedule = async actor => (await db.query("SELECT analytics_ensure_coverage($1,$2,$3) result",[ws,actor,JSON.stringify(f)])).rows[0].result;
    assert.equal((await schedule(operator)).scheduled,3);
    assert.equal((await schedule(operator)).scheduled,0);
    const spans = (await db.query("SELECT from_date::text,to_date::text FROM analytics_sync_jobs WHERE connection_id=$1 AND status='queued' ORDER BY from_date",[c])).rows;
    assert.deepEqual(spans.map(s=>[s.from_date,s.to_date]),[["2026-08-06","2026-08-09"],["2026-08-10","2026-08-15"],["2026-08-16","2026-08-19"],["2026-08-23","2026-08-31"]]);
    await expectDbError(()=>schedule(foreign),/MEMBER_REQUIRED/);
    // The forged connection selection cannot import a connection from another workspace.
    assert.equal((await db.query("SELECT analytics_ensure_coverage($1,$2,$3) result",[foreign,foreign,JSON.stringify(f)])).rows[0].result.scheduled,0);
  } finally { await db.exec("ROLLBACK"); }
});

test("coverage includes proven incrementals and checkpoint days, but never update-only scans or gaps", async () => {
  await db.exec("BEGIN");
  try {
    const c = "33000000-0000-4000-8000-000000000002";
    await db.query("INSERT INTO analytics_connections(id,workspace_id,company_id,name) VALUES($1,$2,$3,'Coverage')",[c,ws,conn1]);
    for (const [a,b,cursor,mode,status,proven] of [
      ["01","10","10","backfill","completed",false],
      ["11","20","20","incremental","completed",true],
      ["21","22","22","incremental","completed",false],
      ["23","31","25","backfill","retry",false],
    ]) await db.query("INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,status,covers_sales) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[ws,c,mode,`2026-08-${a}`,`2026-08-${b}`,`2026-08-${cursor}`,status,proven]);
    const coverage = (await db.query("SELECT analytics_coverage($1,$2) result",[ws,operator])).rows[0].result.filter(s=>s.connection_id===c);
    assert.deepEqual(coverage.map(s=>[s.from_date,s.to_date]),[["2026-08-01","2026-08-20"],["2026-08-23","2026-08-24"]]);
    const { coversPeriod } = require("../src/lib/analytics/coverage.ts");
    assert.equal(coversPeriod(coverage,c,"2026-08-01","2026-08-24"),false);
    assert.equal(coversPeriod(coverage,c,"2026-08-01","2026-08-20"),true);
  } finally { await db.exec("ROLLBACK"); }
});

test("incremental scheduling refreshes the current day without duplicate active or minute-by-minute completed jobs", async () => {
  await db.exec("BEGIN");
  try {
    const c="33000000-0000-4000-8000-000000000004";
    await db.query("INSERT INTO analytics_connections(id,workspace_id,company_id,name) VALUES($1,$2,$3,'Incremental')",[c,ws,conn1]);
    const schedule=async()=> (await db.query("SELECT analytics_schedule_range($1,$2,'2026-10-05','2026-10-06','incremental') count",[ws,c])).rows[0].count;
    assert.equal(await schedule(),1);
    const j=(await db.query("SELECT * FROM analytics_sync_jobs WHERE connection_id=$1",[c])).rows[0];
    assert.equal(j.covers_sales,true); assert.equal(j.query_phase,"sales");
    assert.equal(await schedule(),0);
    await db.query("UPDATE analytics_sync_jobs SET status='completed',updated_at=now() WHERE id=$1",[j.id]);
    assert.equal(await schedule(),0);
    await db.query("UPDATE analytics_sync_jobs SET updated_at=now()-interval '61 minutes' WHERE id=$1",[j.id]);
    assert.equal(await schedule(),1);
    // Long recent history never hides an old pending checkpoint.
    await db.query("UPDATE analytics_sync_jobs SET updated_at='2020-01-01' WHERE connection_id=$1 AND status='queued'",[c]);
    await db.query("INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,status) SELECT $1,$2,'incremental','2026-01-01','2026-01-01','2026-01-01','completed' FROM generate_series(1,220)",[ws,c]);
    const visible=(await db.query("SELECT analytics_job_status($1,$2) result",[ws,operator])).rows[0].result.filter(s=>s.connection_id===c);
    assert.equal(visible.length,11);
    assert.equal(visible.filter(s=>s.status==='queued').length,1);
    assert.equal(visible.some(s=>s.pending_ids!==undefined),false);
  } finally {await db.exec("ROLLBACK");}
});

test("legacy relink verifies workspace, operational snapshot and CNPJ, then resumes the original cursor without changing scanner tokens", async () => {
  await db.exec("BEGIN");
  try {
    const c = "33000000-0000-4000-8000-000000000003";
    const integration = (await db.query("SELECT id,access_token,refresh_token FROM tiny_integrations WHERE workspace_id=$1",[ws])).rows[0];
    await db.query("UPDATE analytics_connections SET legacy_integration_id=null WHERE workspace_id=$1",[ws]);
    await db.query("UPDATE analytics_companies SET tax_id='36965322000112' WHERE id=$1",[conn1]);
    await db.query("INSERT INTO analytics_connections(id,workspace_id,company_id,name,credential_kind) VALUES($1,$2,$3,'Lost legacy','legacy')",[c,ws,conn1]);
    const original = (await db.query("INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,pending_ids,pending_index,processed,status,error_code) VALUES($1,$2,'backfill','2026-08-01','2026-10-02','2026-08-01','[\"123\",\"456\"]',1,3,'failed','authorization_required') RETURNING id",[ws,c])).rows[0];
    const relink = (actor=ws,tax="36965322000112",token=integration.access_token) => db.query("SELECT analytics_relink_legacy($1,$2,$3,1,$4,$5,$6,'safe-fingerprint')",[ws,actor,c,integration.id,token,tax]);
    await expectDbError(()=>relink(operator),/ADMIN_REQUIRED/);
    await expectDbError(()=>relink(ws,"13397731000164"),/CNPJ_MISMATCH/);
    await expectDbError(()=>relink(ws,"36965322000112","changed-token"),/INTEGRATION_CHANGED/);
    await relink();
    const j=(await db.query("SELECT * FROM analytics_sync_jobs WHERE id=$1",[original.id])).rows[0];
    assert.equal(j.status,"queued"); assert.equal(j.processed,3); assert.equal(j.pending_index,1); assert.deepEqual(j.pending_ids,["123","456"]);
    assert.equal(j.error_code,null);
    assert.deepEqual((await db.query("SELECT id,access_token,refresh_token FROM tiny_integrations WHERE workspace_id=$1",[ws])).rows[0],integration);
    assert.equal((await db.query("SELECT legacy_integration_id FROM analytics_connections WHERE id=$1",[c])).rows[0].legacy_integration_id,integration.id);
  } finally { await db.exec("ROLLBACK"); }
});

test("cron SQL validates Vault, is repeatable, restricts invocation and records only request identifiers", async () => {
  await db.exec("BEGIN");
  try {
    // PGlite has no pg_net/pg_cron workers. Stub their documented SQL signatures
    // to execute the deployment function and privilege checks locally.
    await db.exec(`CREATE SCHEMA vault;CREATE SCHEMA net;CREATE SCHEMA cron;
      CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
      CREATE TABLE cron.job(jobid bigserial,jobname text UNIQUE,schedule text,command text);
      CREATE SEQUENCE net.request_ids;
      CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE sql AS $$SELECT nextval('net.request_ids')$$;
      CREATE FUNCTION cron.schedule(name text,timing text,command text) RETURNS bigint LANGUAGE sql AS $$INSERT INTO cron.job(jobname,schedule,command) VALUES(name,timing,command) ON CONFLICT(jobname) DO UPDATE SET schedule=excluded.schedule,command=excluded.command RETURNING jobid$$;
      INSERT INTO vault.decrypted_secrets VALUES('abelha_par_app_url','https://example.test'),('abelha_par_cron_secret','fake-secret-with-at-least-32-characters');`);
    const setup=sql("setup_analytics_cron.sql").replace(/^CREATE EXTENSION[^\n]+\n/gm,"").replace(/^BEGIN;\s*$/gm,"").replace(/^COMMIT;\s*$/gm,"");
    await db.exec(setup); await db.exec(setup);
    assert.equal((await db.query("SELECT * FROM cron.job")).rows.length,1);
    assert.equal((await db.query("SELECT command FROM cron.job")).rows[0].command,"SELECT public.invoke_analytics_sync();");
    assert.equal((await db.query("SELECT * FROM analytics_cron_runs")).rows.length,2);
    assert.equal((await db.query("SELECT has_function_privilege('authenticated','invoke_analytics_sync()','EXECUTE') allowed")).rows[0].allowed,false);
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','analytics_cron_runs','SELECT') allowed")).rows[0].allowed,false);
    await db.exec("UPDATE vault.decrypted_secrets SET decrypted_secret='short' WHERE name='abelha_par_cron_secret'");
    await expectDbError(()=>db.query("SELECT invoke_analytics_sync()"),/Configure.*Vault/);
  } finally {await db.exec("ROLLBACK");}
});

test("large analytical data is aggregated on SQL and returns only a bounded page and Pareto", async (t) => {
  await db.exec("BEGIN");
  // Synthetic benchmark seeding only; FK/security/ingestion are tested above with normal constraints.
  // Avoid measuring WASM's per-row FK trigger cost as if it were report latency.
  await db.exec("SET LOCAL session_replication_role = replica");
  try {
    await db.query(
      "INSERT INTO analytics_products(workspace_id,connection_id,external_id,sku,name) SELECT $1,$2,'bulk-'||n,'BULK-'||n,'Produto volume '||n FROM generate_series(1,5000) n",
      [ws, conn2],
    );
    await db.query(
      "INSERT INTO analytics_orders(workspace_id,company_id,connection_id,source_id,canonical_key,external_id,customer_key,customer_name,sale_date,status,total_cents,fetched_at) SELECT $1,$2,$2,$3,'bulk:'||n,'bulk-'||n,($2::uuid)::text||':bulk-customer','Cliente volume','2026-09-15',1,100,now() FROM generate_series(1,50000) n",
      [ws, conn2, source2],
    );
    await db.query(
      "INSERT INTO analytics_items(workspace_id,order_id,position,connection_id,product_id,quantity,unit_price,gross_cents) SELECT $1,id,0,$2,'bulk-'||(((substring(external_id from 6))::integer-1)%5000+1),1,1,100 FROM analytics_orders WHERE workspace_id=$1 AND external_id LIKE 'bulk-%'",
      [ws, conn2],
    );
    await db.exec("SET LOCAL session_replication_role = origin");
    const start = performance.now(),
      result = await query(filters, 100);
    const elapsed = performance.now() - start;
    assert.equal(result.rows.length, 100);
    assert.equal(result.pareto.length, 60);
    assert.ok(result.total >= 5000);
    assert.ok(JSON.stringify(result).length < 150000);
    t.diagnostic(
      `50,000 orders/items; 5,000 products; SQL aggregate ${elapsed.toFixed(1)} ms; response ${JSON.stringify(result).length} bytes. Local PGlite, not production SLA.`,
    );
  } finally {
    await db.exec("ROLLBACK");
  }
});
test("rollback removes only the analytics layer and preserves operational credentials and history", async () => {
  await db.exec(sql("rollback_v11_analytics_abc.sql"));
  assert.equal(
    (await db.query("SELECT access_token FROM tiny_integrations")).rows[0]
      .access_token,
    "secret-access",
  );
  assert.equal(
    (await db.query("SELECT to_regclass('analytics_orders') name")).rows[0]
      .name,
    null,
  );
  assert.ok(
    (await db.query("SELECT to_regclass('scan_sessions') name")).rows[0].name,
  );
});
