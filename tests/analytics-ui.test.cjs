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
test("dashboard polls existing reports as imports advance without asking the browser to run a worker", async t => {
  let tick;
  t.mock.method(global,"setInterval",callback=>{tick=callback;return 999;});
  t.mock.method(global,"clearInterval",()=>{});
  const pending = { connection_id:"c1",mode:"backfill",status:"queued",from_date:"2026-08-01",to_date:"2026-10-02",cursor_date:"2026-08-01",processed:3 };
  state.jobs.push(pending);
  await click(button("Atualizar"));
  assert.equal(typeof tick,"function");
  assert.match(document.body.textContent,/3 pedidos processados/);
  const before=requests.filter(r=>r.url.endsWith("/abc")).length;
  pending.processed=6;
  pending.cursor_date="2026-08-02";
  await act(async()=>tick());
  assert.ok(requests.filter(r=>r.url.endsWith("/abc")).length>before);
  assert.match(document.body.textContent,/6 pedidos processados/);
  assert.equal(requests.some(r=>r.url.includes("/analytics/sync")),false);
  state.jobs.pop();
  await click(button("Atualizar"));
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

test("Ninho explains a failed OAuth callback and keeps reauthorization available while CNPJ validation is blocked", async t => {
  const { AnalyticsConnections } = require("../src/components/ninho/analytics-connections.tsx");
  dom.window.history.replaceState(null, "", "/ninho?analyticsError=account_unavailable");
  const oauthState = {
    companies: [{ id: "company-3", name: "Olist 3", tax_id: "37201039000187" }],
    connections: [{
      id: "connection-3", company_id: "company-3", name: "Olist 3",
      credential_kind: "oauth", enabled: true, client_id: "client-3",
      expires_at: null, verified_at: null, verified_tax_id: null,
      last_error: null, last_synced_at: null,
    }],
    jobs: [], sources: [],
  };
  const calls = [];
  t.mock.method(global, "fetch", async (url, options = {}) => {
    calls.push({ url, options });
    return Response.json(oauthState);
  });
  await act(async () => root.render(React.createElement(AnalyticsConnections)));
  assert.match(document.querySelector('[role="alert"]').textContent, /consulta do CNPJ.*timeout/);
  assert.ok(document.body.textContent.includes("Autorização pendente"));
  assert.equal(button("Validar CNPJ na API").disabled, true);
  assert.equal(document.querySelector('a[href="/api/analytics/oauth/login?connection=connection-3"]').textContent, "Autorizar esta conta");
  await click(button("Validar CNPJ na API"));
  assert.equal(calls.filter(c => c.options.method === "POST").length, 0);
  oauthState.connections[0].expires_at = "2026-10-03T03:00:00Z";
  oauthState.connections[0].verified_at = "2026-10-02T23:00:00Z";
  await click(document.querySelector('button[aria-label="Atualizar conexões analíticas"]'));
  assert.equal(button("Validar CNPJ na API").disabled, false);
  assert.ok(document.body.textContent.includes("CNPJ validado"));
});

test("Ninho exposes a clear lost legacy link repair and keeps OAuth credentials out of that flow", async t => {
  const { AnalyticsConnections } = require("../src/components/ninho/analytics-connections.tsx");
  dom.window.history.replaceState(null,"","/ninho");
  const calls=[];
  const legacy={companies:[{id:"company2",name:"Olist 2",tax_id:"36965322000112"}],connections:[{id:"legacy2",company_id:"company2",name:"Olist 2",credential_kind:"legacy",legacy_integration_id:null,enabled:true,verified_at:null}],jobs:[],sources:[],coverage:[]};
  t.mock.method(global,"fetch",async(url,options={})=>{calls.push({url,body:options.body && JSON.parse(options.body)});return Response.json(legacy);});
  await act(async()=>{root.render(React.createElement(AnalyticsConnections,{key:"legacy"}));});
  assert.match(document.body.textContent,/Vínculo operacional perdido/);
  assert.equal(button("Validar CNPJ na API").disabled,true);
  await click(button("Restabelecer vínculo operacional"));
  assert.deepEqual(calls.find(c=>c.body)?.body,{action:"relink",id:"legacy2"});
  assert.equal(calls.some(c=>c.url.includes("oauth")||c.url.includes("/auth/disconnect")),false);
});
