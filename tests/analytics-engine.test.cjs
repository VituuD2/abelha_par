require("./setup.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  rankABC,
  decimalUnits,
  lineCents,
} = require("../src/lib/analytics/engine.ts");
const { normalizeOrder } = require("../src/lib/analytics/normalize.ts");
const { parseABCFilters } = require("../src/lib/analytics/filters.ts");
const { coversPeriod } = require("../src/lib/analytics/coverage.ts");
const { reportReliability } = require("../src/lib/analytics/reliability.ts");
const { exportCoverageMetadata } = require("../src/lib/analytics/export.ts");

test("unlinked Olist items retain exact money and unique order/position identity without inventing catalog equivalence", () => {
  const raw = { id: 71, data: "2026-10-05", situacao: 6, itens: [0, 0].map(() => ({
    produto: { id: 0, sku: "SAME", descricao: "Item real" }, quantidade: "0.5", valorUnitario: "12.3456",
  })) };
  const n = normalizeOrder(raw, "c1", "s1", "2026-10-16T00:00:00Z");
  assert.deepEqual(n.items.map(i => i.product_id), ["order:71:item:0", "order:71:item:1"]);
  assert.deepEqual(n.items.map(i => i.gross_cents), ["617", "617"]);
  assert.ok(n.order.quality_flags.includes("item_sem_vinculo_catalogo"));
  assert.match(n.items[0].name, /sem vínculo de catálogo/);
  assert.equal(n.items[0].parent_id, null);
  assert.equal(normalizeOrder(raw, "c1", "s1", "2026-10-16T00:00:00Z").items[0].product_id, n.items[0].product_id);
  assert.notEqual(normalizeOrder({ ...raw, id: 72 }, "c1", "s1", "2026-10-16T00:00:00Z").items[0].product_id, n.items[0].product_id);
  assert.throws(() => normalizeOrder({ ...raw, itens: [{ ...raw.itens[0], produto: { id: "bad" } }] }, "c1", "s1", "2026-10-16T00:00:00Z"), /Identificador/);
});

test("coverage distinguishes missing history, import, sync failure and genuinely empty filtered results; exports share selected scope", () => {
  const filters = { from: "2026-09-01", to: "2026-09-30", selections: { companies: ["co1"] } };
  const status = { companies: [{ id: "co1", name: "Olist 1" }, { id: "co2", name: "Olist 2" }],
    connections: [{ id: "c1", company_id: "co1", name: "Olist 1", enabled: true, verified_at: "2026-09-01" },
      { id: "c2", company_id: "co2", name: "Olist 2", enabled: true }], jobs: [], coverage: [] };
  assert.equal(reportReliability(status, filters).state, "uncovered");
  const j = { connection_id: "c1", mode: "backfill", status: "queued", from_date: filters.from, to_date: filters.to };
  status.jobs.push(j);
  assert.equal(reportReliability(status, filters).state, "importing");
  j.last_error = "Falha"; j.status = "retry";
  assert.equal(reportReliability(status, filters).state, "sync_error");
  assert.match(reportReliability(status, filters).emptyTitle, /sincronização com falha/);
  j.status = "completed"; j.last_error = null; status.coverage.push(j);
  assert.equal(reportReliability(status, filters).state, "covered");
  assert.match(reportReliability(status, filters).emptyTitle, /Nenhuma venda elegível/);
  const metadata = exportCoverageMetadata(filters, status).flat().join(" ");
  assert.match(metadata, /provisória/);
  assert.match(metadata, /Olist 1/);
  assert.doesNotMatch(metadata, /Olist 2/);
  assert.equal(reportReliability(status, { ...filters, selections: {} }).complete, false);
});
const { progressVersion } = require("../src/lib/analytics/progress.ts");

test("progress version ignores heartbeats and row ordering but detects imported orders and coverage changes",()=>{
  const s={connections:[{id:"c",enabled:true}],jobs:[{id:"a",connection_id:"c",status:"queued",processed:3},{id:"b",connection_id:"c",status:"queued",processed:0}],coverage:[]};
  const version=progressVersion(s);
  assert.equal(progressVersion({...s,jobs:[...s.jobs].reverse().map(j=>({...j,updated_at:"new-heartbeat"}))}),version);
  assert.notEqual(progressVersion({...s,jobs:[{...s.jobs[0],processed:4},s.jobs[1]]}),version);
  assert.notEqual(progressVersion({...s,coverage:[{connection_id:"c",from_date:"2026-08-01",to_date:"2026-08-01"}]}),version);
});
const {
  createAnalyticsState,
  verifyAnalyticsState,
} = require("../src/lib/analytics/auth.ts");
const { csvCell, exportRow } = require("../src/lib/analytics/export.ts");
const row = (id, revenue, quantity = "1") => ({
  entityId: id,
  revenue: String(revenue),
  quantity: String(quantity),
  orders: 1,
  name: id,
  sku: id,
});
test("Tiny legacy and strict modes differ at crossings and preserve exact boundaries", () => {
  const data = [row("a", 80), row("b", 15), row("c", 5)];
  assert.deepEqual(
    rankABC(data).map((r) => r.class),
    ["A", "B", "C"],
  );
  assert.deepEqual(
    rankABC(data, "revenue", "STRICT_CUMULATIVE").map((r) => r.class),
    ["B", "C", "C"],
  );
  assert.deepEqual(
    rankABC(data).map((r) => r.cumulativeBefore),
    [0, 80, 95],
  );
  assert.deepEqual(
    rankABC([row("a", 9968), row("b", 32)]).map((r) => r.class),
    ["A", "C"],
  );
});
test("empty, zero, one entity, deterministic ties, quantity and many entities", () => {
  assert.deepEqual(rankABC([]), []);
  assert.equal(rankABC([row("a", 0)])[0].class, "C");
  assert.equal(rankABC([row("a", 1)])[0].class, "A");
  assert.equal(
    rankABC([row("a", 1)], "revenue", "STRICT_CUMULATIVE")[0].class,
    "C",
  );
  assert.deepEqual(
    rankABC([row("z", 100, 1), row("b", 100, 2), row("a", 100, 2)]).map(
      (r) => r.entityId,
    ),
    ["a", "b", "z"],
  );
  assert.deepEqual(
    rankABC([row("a", 1, 20), row("b", 100, 1)], "quantity").map(
      (r) => r.entityId,
    ),
    ["a", "b"],
  );
  const many = rankABC(
    Array.from({ length: 10000 }, (_, i) => row(String(i).padStart(5, "0"), 1)),
  );
  assert.equal(many.at(-1).cumulative, 100);
  assert.equal(many[8000].class, "B");
  assert.equal(many[9500].class, "C");
  assert.throws(() => rankABC([], "revenue", "TINY_LEGACY", 95, 80));
});
test("decimal money is exact, large amounts remain strings, lines round once", () => {
  assert.equal(
    decimalUnits("9007199254740993.99", 2).toString(),
    "900719925474099399",
  );
  assert.equal(lineCents("0.1", "3"), "30");
  assert.equal(lineCents("0.005", "1"), "1");
  assert.equal(lineCents("12.3456", "0.5"), "617");
  assert.equal(lineCents("-1", "1"), "-100");
  assert.equal(lineCents("-0.005", "1"), "-1");
  assert.equal(lineCents("-12.3456", "0.5"), "-617");
  assert.throws(() => lineCents("-1", "-1"));
  assert.throws(() => decimalUnits("-1"));
  assert.equal(
    exportRow(row("a", "900719925474099399"))[3],
    "9007199254740993.99",
  );
  assert.equal(csvCell('=HYPERLINK("unsafe")'), '"\'=HYPERLINK(""unsafe"")"');
});
test("normalizer scopes customer/product identities, uses documented parent and flags missing enrichment", () => {
  const raw = {
    id: 1,
    numeroPedido: 2,
    data: "2026-09-01",
    situacao: 1,
    valorTotalPedido: "30",
    cliente: { id: 8, nome: "Cliente", endereco: { uf: "SP" } },
    ecommerce: { id: 4, nome: "Integração", numeroPedidoEcommerce: "100" },
    itens: [
      {
        produto: { id: 7, sku: "SKU", descricao: "Variação" },
        quantidade: "3",
        valorUnitario: "10",
      },
    ],
  };
  const enriched = {
    7: {
      id: 7,
      produtoPai: { id: 9, descricao: "Pai" },
      categoria: { nome: "Categoria" },
      marca: { nome: "Marca" },
    },
  };
  const { order, items } = normalizeOrder(
    raw,
    "conn",
    "source",
    "2026-09-02T00:00:00Z",
    enriched,
    { situacao: 6, tipo: "S", finalidade: 1, dataEmissao: "2026-09-01" },
    [{ descricao: "tag" }],
  );
  assert.equal(items[0].parent_id, "9");
  assert.equal(items[0].gross_cents, "3000");
  assert.equal(order.customer_key, "conn:customer:8");
  assert.equal(order.invoice_eligible, true);
  assert.deepEqual(order.tags, ["tag"]);
  const noParent = normalizeOrder(
    { ...raw, cliente: { nome: "Mesmo nome" } },
    "another",
    "source",
    "2026-09-02T00:00:00Z",
  );
  assert.equal(noParent.items[0].parent_id, null);
  assert.equal(noParent.order.customer_key, "another:customer:order:1");
  assert.ok(noParent.order.quality_flags.includes("cliente_sem_id"));
  assert.throws(() =>
    normalizeOrder(
      { ...raw, itens: [] },
      "conn",
      "source",
      "2026-09-02T00:00:00Z",
    ),
  );
});
test("filters validate dimensions, dates, limits and default statuses", () => {
  const f = {
    from: "2026-09-01",
    to: "2026-09-30",
    metric: "revenue",
    mode: "TINY_LEGACY",
    grouping: "product",
    basis: "orders",
    thresholdA: 80,
    thresholdB: 95,
    selections: { companies: ["1", "3", "1"] },
  };
  assert.deepEqual(parseABCFilters(f).selections.companies, ["1", "3"]);
  assert.deepEqual(parseABCFilters(f).selections.statuses, ["1", "5", "6"]);
  for (const bad of [
    { from: "2026-02-30" },
    { to: "2026-08-31" },
    { thresholdA: 100 },
    { metric: "profit" },
    { selections: { secret: ["a"] } },
  ])
    assert.throws(() => parseABCFilters({ ...f, ...bad }));
});
test("coverage joins adjacent complete backfills and never claims gaps or incremental scans cover history", () => {
  const span = (a, b) => ({
    connection_id: "x",
    mode: "backfill",
    status: "completed",
    from_date: a,
    to_date: b,
  });
  assert.equal(
    coversPeriod(
      [span("2026-09-01", "2026-09-15"), span("2026-09-16", "2026-09-30")],
      "x",
      "2026-09-01",
      "2026-09-30",
    ),
    true,
  );
  assert.equal(
    coversPeriod(
      [span("2026-09-01", "2026-09-15"), span("2026-09-17", "2026-09-30")],
      "x",
      "2026-09-01",
      "2026-09-30",
    ),
    false,
  );
  assert.equal(
    coversPeriod(
      [{ ...span("2026-09-01", "2026-09-30"), mode: "incremental" }],
      "x",
      "2026-09-01",
      "2026-09-30",
    ),
    false,
  );
  assert.equal(coversPeriod([
    span("2026-09-01", "2026-09-15"),
    { ...span("2026-09-16", "2026-09-30"), mode: "incremental", covers_sales: true },
  ], "x", "2026-09-01", "2026-09-30"), true);
});
test("OAuth state binds user, workspace, connection and configuration version; rejects tampering and expiry", () => {
  const previous = process.env.TOKEN_ENCRYPTION_KEY;
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString("base64");
  try {
    const { state, payload } = createAnalyticsState("user", {
      workspace_id: "workspace",
      id: "conn",
      version: 2,
    });
    assert.equal(verifyAnalyticsState(state, "user", "workspace").version, 2);
    assert.equal(verifyAnalyticsState(state, "other", "workspace"), null);
    assert.equal(verifyAnalyticsState(state, "user", "other"), null);
    assert.equal(verifyAnalyticsState(state + "x", "user", "workspace"), null);
    assert.equal(verifyAnalyticsState("bad", "user", "workspace"), null);
    assert.equal(payload.connection, "conn");
  } finally {
    if (previous === undefined) delete process.env.TOKEN_ENCRYPTION_KEY;
    else process.env.TOKEN_ENCRYPTION_KEY = previous;
  }
});
