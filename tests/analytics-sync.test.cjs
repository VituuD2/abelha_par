require("./setup.cjs");
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const admin = require("../src/lib/supabase/admin.ts"),
  auth = require("../src/lib/analytics/auth.ts"),
  provider = require("../src/lib/analytics/olist-client.ts");
const { processAnalyticsBatch } = require("../src/lib/analytics/sync.ts");
const { AnalyticsActionError } = require("../src/lib/analytics/sync-errors.ts");
function fixture() {
  const job = {
    id: "job",
    workspace_id: "workspace",
    connection_id: "connection",
    mode: "backfill",
    from_date: "2026-09-01",
    to_date: "2026-09-01",
    cursor_date: "2026-09-01",
    page_offset: 0,
    pending_ids: [],
    pending_index: 0,
    page_done: false,
    processed: 0,
    pages: 0,
    attempts: 0,
    lease_token: "lease",
    lease_until: "2099-01-01T00:00:00Z",
    status: "running",
  };
  const tables = {
    analytics_sync_jobs: [job],
    analytics_connections: [
      { id: "connection", workspace_id: "workspace", sync_lock: "lease" },
    ],
    analytics_products: [],
    analytics_sources: [],
  };
  const ingested = [];
  const db = {
    from(table) {
      let op = "read",
        patch,
        filters = [],
        single = false;
      const chain = {
        select() {
          return chain;
        },
        eq(k, v) {
          filters.push((r) => r[k] === v);
          return chain;
        },
        gt(k, v) {
          filters.push((r) => r[k] > v);
          return chain;
        },
        maybeSingle() {
          single = true;
          return chain;
        },
        single() {
          single = true;
          return chain;
        },
        update(value) {
          op = "update";
          patch = value;
          return chain;
        },
        upsert(value) {
          op = "upsert";
          patch = value;
          return chain;
        },
        then(resolve) {
          let rows = tables[table] || [];
          if (op === "upsert") {
            let existing = rows.find(
              (r) =>
                r.workspace_id === patch.workspace_id &&
                r.connection_id === patch.connection_id &&
                r.external_id === patch.external_id,
            );
            if (existing) Object.assign(existing, patch);
            else {
              existing = { id: "id-" + rows.length, ...patch };
              rows.push(existing);
            }
            rows = [existing];
          } else {
            rows = rows.filter((r) => filters.every((f) => f(r)));
            if (op === "update") rows.forEach((r) => Object.assign(r, patch));
          }
          return Promise.resolve({
            data: single ? rows[0] || null : rows,
            error: null,
          }).then(resolve);
        },
      };
      return chain;
    },
    async rpc(name, params) {
      if (name === "analytics_claim_job")
        return {
          data: [{ ...job, pending_ids: [...job.pending_ids] }],
          error: null,
        };
      if (name === "analytics_ingest") {
        ingested.push(params);
        return { data: "order", error: null };
      }
      throw new Error(name);
    },
  };
  return { db, job, tables, ingested };
}
const raw = (id, channel) => ({
  id,
  data: "2026-09-01",
  situacao: 1,
  valorTotalPedido: "10",
  ecommerce: { id: channel, nome: "Canal " + channel },
  cliente: { id: 1, nome: "Cliente" },
  itens: [
    {
      produto: { id: 10, sku: "SKU", descricao: "Produto" },
      quantidade: 1,
      valorUnitario: 10,
    },
  ],
});
test("analytics ingests all origins, persists progress, caches products and releases the original lease", async (t) => {
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  const f = fixture(),
    paths = [];
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "analyticsToken", async () => "not-a-real-token");
  t.mock.method(provider, "olistRequest", async (_token, _conn, path) => {
    paths.push(path);
    if (path.startsWith("/pedidos?"))
      return { itens: [{ id: 1 }, { id: 2 }], paginacao: { total: 2 } };
    if (path === "/produtos/10")
      return { id: 10, descricao: "Produto", sku: "SKU" };
    if (path.endsWith("/marcadores")) return { itens: [{ descricao: "Marcador" }] };
    return raw(path.endsWith("/1") ? 1 : 2, path.endsWith("/1") ? 101 : 202);
  });
  const result = await processAnalyticsBatch("workspace");
  assert.equal(result.processed, 2);
  assert.equal(f.job.status, "completed");
  assert.equal(f.job.pending_ids.length, 0);
  assert.equal(f.tables.analytics_connections[0].sync_lock, null);
  assert.equal(f.tables.analytics_sources.length, 2);
  assert.equal(f.ingested.length, 2);
  assert.equal(paths.filter((p) => p === "/produtos/10").length, 1);
  assert.ok(!paths[0].includes("ecommerce"));
  assert.ok(paths[0].includes("dataInicial=2026-09-01"));
  assert.deepEqual(f.ingested[0].p_order.tags, ["Marcador"]);
});
test("rate limiting preserves pending order and schedules a retry without persisting a partial sale", async (t) => {
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  const f = fixture();
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "analyticsToken", async () => "token");
  t.mock.method(provider, "olistRequest", async (_t, _c, path) => {
    if (path.startsWith("/pedidos?"))
      return { itens: [{ id: 1 }], paginacao: { total: 1 } };
    throw new provider.AnalyticsApiError(429, 60);
  });
  const before = Date.now(),
    result = await processAnalyticsBatch("workspace");
  assert.equal(result.pending, true);
  assert.equal(f.job.status, "retry");
  assert.deepEqual(f.job.pending_ids, ["1"]);
  assert.equal(f.job.pending_index, 0);
  assert.equal(f.ingested.length, 0);
  assert.ok(Date.parse(f.job.next_at) >= before + 60000);
  assert.equal(f.tables.analytics_connections[0].sync_lock, null);
});
test("an incremental job uses update date; inaccessible optional enrichment is flagged, not invented", async (t) => {
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  const f = fixture();
  f.job.mode = "incremental";
  const paths = [];
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "analyticsToken", async () => "token");
  t.mock.method(provider, "olistRequest", async (_t, _c, path) => {
    paths.push(path);
    if (path.startsWith("/pedidos?"))
      return { itens: [{ id: 1 }], paginacao: { total: 1 } };
    if (path === "/pedidos/1") return { ...raw(1, 101), idNotaFiscal: 42 };
    throw new provider.AnalyticsApiError(403);
  });
  await processAnalyticsBatch("workspace");
  assert.ok(paths[0].includes("dataAtualizacao=2026-09-01"));
  assert.ok(!paths[0].includes("dataInicial"));
  assert.equal(f.ingested[0].p_order.invoice_eligible, false);
  assert.equal(f.ingested[0].p_items[0].parent_id, null);
  assert.ok(f.ingested[0].p_order.quality_flags.includes("nota_nao_validada"));
  assert.ok(
    f.ingested[0].p_order.quality_flags.includes("marcadores_indisponiveis"),
  );
  assert.equal(
    f.tables.analytics_connections[0].incremental_through,
    "2026-09-01",
  );
});

test("new incremental coverage waits for both sale and update scans to complete", async (t) => {
  const f = fixture(), paths = [];
  f.job.mode = "incremental";
  f.job.query_phase = "sales";
  f.job.covers_sales = true;
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "analyticsToken", async () => "token");
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  t.mock.method(provider, "olistRequest", async (_t, _c, path) => {
    paths.push(path);
    return { itens: [], paginacao: { total: 0 } };
  });
  await processAnalyticsBatch("workspace");
  assert.equal(f.job.status, "queued");
  assert.equal(f.job.query_phase, "updates");
  assert.equal(f.job.cursor_date, "2026-09-01");
  // Simulate the next cron lease, independent of any browser request.
  f.job.lease_token = "lease";
  f.job.lease_until = "2099-01-01T00:00:00Z";
  f.tables.analytics_connections[0].sync_lock = "lease";
  await processAnalyticsBatch();
  assert.equal(f.job.status, "completed");
  assert.match(paths[0], /dataInicial=2026-09-01/);
  assert.match(paths[1], /dataAtualizacao=2026-09-01/);
});

test("expired authorization blocks a checkpoint with reconnection guidance; transient outages keep retrying", async (t) => {
  const f = fixture();
  f.job.attempts = 12;
  f.job.pending_ids = ["123"];
  f.job.pending_index = 0;
  t.mock.method(admin, "createAdminClient", () => f.db);
  t.mock.method(auth, "ensureAnalyticsIdentity", async () => {});
  t.mock.method(auth, "analyticsToken", async () => {
    throw new AnalyticsActionError("authorization_required", "Reconecte esta conta no Ninho.");
  });
  const result = await processAnalyticsBatch();
  assert.match(result.error, /Reconecte/);
  assert.equal(f.job.status, "failed");
  assert.equal(f.job.error_code, "authorization_required");
  assert.deepEqual(f.job.pending_ids, ["123"]);
  assert.equal(f.tables.analytics_connections[0].error_code, "authorization_required");
  f.job.lease_token = "lease";
  f.job.lease_until = "2099-01-01T00:00:00Z";
  t.mock.method(auth, "analyticsToken", async () => { throw new Error("Falha temporária."); });
  await processAnalyticsBatch();
  assert.equal(f.job.status, "retry");
  assert.equal(f.job.error_code, null);
  assert.deepEqual(f.job.pending_ids, ["123"]);
});
