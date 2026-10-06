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
  assert.throws(() => lineCents("-1", "1"));
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
