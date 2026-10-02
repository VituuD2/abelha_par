require("./setup.cjs");
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const fs = require("node:fs"),
  Module = require("node:module"),
  ts = require("typescript");
const dom = new JSDOM('<!doctype html><div id="app"></div>', {
  url: "http://localhost:3000/analytics/abc",
});
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.open = false;
  this.dispatchEvent(new dom.window.Event("close"));
};
require.extensions[".tsx"] = (module, filename) => {
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
};
const React = require("react"),
  { act } = React,
  { createRoot } = require("react-dom/client");
const original = Module._load;
Module._load = function (name, ...args) {
  if (name === "next/link")
    return ({ children, ...props }) =>
      React.createElement("a", props, children);
  return original.call(this, name, ...args);
};
const {
  ABCDashboard,
} = require("../src/components/analytics/abc-dashboard.tsx");
Module._load = original;
const root = createRoot(document.getElementById("app")),
  originalFetch = global.fetch;
let requests = [];
const rows = Array.from({ length: 100 }, (_, i) => ({
  entityId: "conn:prod-" + i,
  name: "Produto " + i,
  sku: "SKU-" + i,
  revenue: "100",
  quantity: "1.000000",
  orders: 1,
  rank: i + 1,
  class: i < 80 ? "A" : i < 95 ? "B" : "C",
  percent: 1,
  cumulativeBefore: i,
  cumulative: i + 1,
}));
const state = {
  companies: [
    { id: "1", name: "Empresa 1" },
    { id: "2", name: "Empresa 2" },
    { id: "3", name: "Empresa 3" },
  ],
  connections: [1, 2, 3].map((i) => ({
    id: "c" + i,
    company_id: String(i),
    name: "Olist " + i,
    enabled: true,
    verified_at: "2026-10-01",
    last_synced_at: "2026-10-01",
  })),
  jobs: [1, 2, 3].map((i) => ({
    connection_id: "c" + i,
    mode: "backfill",
    status: "completed",
    from_date: "2020-01-01",
    to_date: "2100-01-01",
  })),
  options: {
    companies: [1, 2, 3].map((i) => ({
      value: String(i),
      label: "Empresa " + i,
    })),
  },
};
before(() => {
  global.fetch = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ url, body });
    let data = url.includes("options")
      ? state
      : url.includes("drilldown")
        ? {
            total: 1,
            companies: [
              { name: "Empresa 1", revenue: "100", quantity: "1", orders: 1 },
            ],
            channels: [
              { name: "Canal real", revenue: "100", quantity: "1", orders: 1 },
            ],
            orders: [
              {
                id: "100",
                number: "100",
                date: "2026-09-01",
                status: 1,
                company: "Empresa 1",
                source: "Canal real",
                connection: "Olist 1",
                revenue: "100",
                quantity: "1",
              },
            ],
          }
        : {
            rows: rows.slice(
              ((body?.page || 1) - 1) * (body?.size || 50),
              (body?.page || 1) * (body?.size || 50),
            ),
            total: 100,
            revenue: "10000",
            quantity: "100.000000",
            orders: 100,
            classes: {
              A: { count: 80, revenue: "8000", quantity: "80", percent: 80 },
              B: { count: 15, revenue: "1500", quantity: "15", percent: 15 },
              C: { count: 5, revenue: "500", quantity: "5", percent: 5 },
            },
            top10: 10,
            pareto: rows.slice(0, 60),
            generatedAt: "2026-10-01T00:00:00Z",
          };
    return new Response(JSON.stringify(data), {
      headers: { "Content-Type": "application/json" },
    });
  };
});
after(async () => {
  await act(async () => root.unmount());
  global.fetch = originalFetch;
  dom.window.close();
});
const click = async (el) =>
  act(async () => {
    el.click();
  });
const button = (text) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text);
test("dashboard renders cards and only the selected page, applies multi-company filters and keeps server rank on sort", async () => {
  await act(async () =>
    root.render(React.createElement(ABCDashboard, { isAdmin: true })),
  );
  assert.ok(document.body.textContent.includes("Valor bruto dos itens"));
  assert.equal(document.querySelectorAll("tbody tr").length, 50);
  assert.equal(document.querySelectorAll('svg[role="img"]').length, 1);
  assert.equal(document.querySelector('[role="alert"]'), null);
  for (const name of ["Empresa 1", "Empresa 3"]) {
    const label = [...document.querySelectorAll("label")].find(
      (l) => l.textContent === name,
    );
    await click(label.querySelector("input"));
  }
  await click(button("Analisar vendas"));
  assert.deepEqual(
    requests.filter((r) => r.url.endsWith("/abc")).at(-1).body.filters
      .selections.companies,
    ["1", "3"],
  );
  await click(button("Valor bruto"));
  const sorted = requests.filter((r) => r.url.endsWith("/abc")).at(-1).body;
  assert.equal(sorted.sort, "revenue");
  assert.deepEqual(sorted.filters.selections.companies, ["1", "3"]);
  await click(document.querySelector('button[aria-label="Próxima página"]'));
  assert.equal(document.querySelectorAll("tbody tr").length, 50);
  assert.ok(document.body.textContent.includes("Produto 99"));
});
test("drilldown traces orders and native dialog closes; client tab changes grouping on server", async () => {
  await click(button("Produto 50"));
  assert.equal(document.querySelector("dialog").open, true);
  assert.ok(
    document.querySelector("dialog").textContent.includes("Canal real"),
  );
  await click(document.querySelector('button[aria-label="Fechar detalhes"]'));
  assert.equal(document.querySelector("dialog").open, false);
  await click(button("Clientes"));
  assert.equal(
    requests.filter((r) => r.url.endsWith("/abc")).at(-1).body.filters.grouping,
    "customer",
  );
});
test("missing coverage stays visibly partial and a server error does not leave a misleading old result", async () => {
  state.connections[0].verified_at = null;
  await click(button("Atualizar"));
  assert.ok(document.body.textContent.includes("Escopo parcial"));
  global.fetch = async () =>
    new Response(JSON.stringify({ error: "Migração v11 pendente" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  await click(button("Atualizar"));
  assert.ok(
    document
      .querySelector('[role="alert"]')
      .textContent.includes("Migração v11"),
  );
  assert.equal(
    [...document.querySelectorAll("tbody tr")].filter(
      (row) => !row.closest("dialog"),
    ).length,
    0,
  );
});
