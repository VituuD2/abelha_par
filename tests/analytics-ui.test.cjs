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
require('./dom-setup.cjs')(dom.window);
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
    let data = url.includes("options") || url.endsWith("/sync")
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
            pareto: rows,
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
  assert.equal(document.querySelectorAll("tbody tr").length, 25);
  assert.equal(document.querySelectorAll('svg[role="img"]').length, 1);
  assert.equal(document.querySelector('[role="alert"]'), null);
  await click(button("Mais filtros"));
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
  assert.equal(document.querySelectorAll("tbody tr").length, 25);
  assert.ok(document.querySelector('tbody').textContent.includes("Produto 49"));
  assert.match(document.body.textContent, /26–50 de 100 registros/);
});
test("drilldown traces orders and native dialog closes; client tab changes grouping on server", async () => {
  await click(button("Produto 25"));
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
  t.mock.method(global,"setInterval",(callback,interval)=>{assert.equal(interval,15000);tick=callback;return 999;});
  t.mock.method(global,"clearInterval",()=>{});
  const pending = { connection_id:"c1",mode:"backfill",status:"queued",from_date:"2026-08-01",to_date:"2026-10-02",cursor_date:"2026-08-01",processed:3 };
  state.jobs.push(pending);
  await click(button("Atualizar"));
  assert.equal(typeof tick,"function");
  assert.doesNotMatch(document.body.textContent,/3 pedidos processados/);
  const before=requests.filter(r=>r.url.endsWith("/abc")).length;
  const requestsBeforeHidden=requests.length;
  Object.defineProperty(document,"visibilityState",{configurable:true,value:"hidden"});
  try {
    await act(async()=>tick());
    assert.equal(requests.length,requestsBeforeHidden);
  } finally {delete document.visibilityState;}
  await act(async()=>tick());
  assert.equal(requests.filter(r=>r.url.endsWith("/abc")).length,before);
  pending.processed=6;
  pending.cursor_date="2026-08-02";
  await act(async()=>tick());
  assert.ok(requests.filter(r=>r.url.endsWith("/abc")).length>before);
  assert.doesNotMatch(document.body.textContent,/6 pedidos processados/);
  assert.equal(requests.some(r=>r.url.includes("/analytics/sync") && r.body),false);
  assert.equal(requests.filter(r=>r.url.endsWith("/abc")).at(-1).body.ensureCoverage,false);
  state.jobs.pop();
  await click(button("Atualizar"));
});

test("missing coverage keeps import details hidden and a server error does not leave a misleading old result", async () => {
  state.connections[0].verified_at = null;
  await click(button("Atualizar"));
  assert.ok(!document.body.textContent.includes("Escopo parcial"));
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
      (row) => !row.closest("dialog") && !row.closest('[aria-hidden="true"]'),
    ).length,
    0,
  );
});

test("late success and network failure from aborted reports cannot overwrite the latest grouping", async t => {
  for (const lateFailure of [false, true]) {
    let settleOld, first = true;
    const latest = { rows: [rows[0]],total:1,revenue:"100",quantity:"1",orders:1,classes:{},top10:100,pareto:[rows[0]],generatedAt:"2026-10-16T00:00:00Z" };
    t.mock.method(global,"fetch",async (url) => {
      if (!url.endsWith("/abc")) return Response.json(state);
      if (first) { first=false; return new Promise((resolve,reject)=>{settleOld=()=>lateFailure?reject(new TypeError("obsolete network failure")):resolve(Response.json({...latest,rows:[{...rows[0],name:"Obsoleto"}]}));}); }
      return Response.json({...latest,rows:[{...rows[0],name:"Resultado atual"}]});
    });
    await act(async()=>root.render(React.createElement(ABCDashboard,{isAdmin:false,key:"race-"+lateFailure})));
    await click(button("Clientes"));
    assert.match(document.querySelector("tbody").textContent,/Resultado atual/);
    await act(async()=>settleOld());
    assert.match(document.querySelector("tbody").textContent,/Resultado atual/);
    assert.doesNotMatch(document.body.textContent,/obsolete network failure|Obsoleto/);
  }
});

test("operator can recover after export failure without losing the report or getting stuck exporting", async t => {
  const latest={rows:[rows[0]],total:1,revenue:"100",quantity:"1",orders:1,classes:{},top10:100,pareto:[rows[0]],generatedAt:"2026-10-16T00:00:00Z"};
  t.mock.method(global,"fetch",async(url)=>url.endsWith("/export")
    ? Response.json({error:"Exportação temporariamente indisponível"},{status:503})
    : Response.json(url.endsWith("/abc")?latest:state));
  await act(async()=>root.render(React.createElement(ABCDashboard,{isAdmin:false,key:"operator-export"})));
  await click(button("CSV completo"));
  assert.match(document.querySelector('[role="alert"]').textContent,/Exportação temporariamente/);
  assert.equal(button("CSV completo").disabled,false);
  assert.equal(document.querySelectorAll("tbody tr").length,1);
  assert.equal(document.querySelector('a[href="/ninho"]'),null);
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
  assert.ok(document.body.textContent.includes("Conectada"));
  assert.equal(document.querySelector('a[href="/api/analytics/oauth/login?connection=connection-3"]'), null);
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

test('Ninho groups usage under the matching account and offers no reconnect for healthy or temporarily delayed accounts',async t=>{
  const {AnalyticsConnections}=require('../src/components/ninho/analytics-connections.tsx');
  // Dispose the previous real poll before replacing timers for this scenario.
  await act(async()=>root.render(null));
  dom.window.history.replaceState(null,'','/ninho');
  const current={companies:[],jobs:[],sources:[],coverage:[],connections:[
    {id:'first',name:'Olist 1',enabled:true,credential_kind:'oauth',client_id:'app',expires_at:'2000-01-01',refresh_expires_at:'2099-01-01',verified_at:'2026-10-20',last_error:'Limite da API Olist atingido'},
    {id:'second',name:'Olist 2',enabled:true,credential_kind:'legacy',legacy_integration_id:'linked',verified_at:'2026-10-20',last_error:'Controle de consultas indisponível'},
    {id:'third',name:'Olist 3',enabled:true,credential_kind:'oauth',client_id:'app3',expires_at:'2000-01-01',refresh_expires_at:'2099-01-01',verified_at:'2026-10-20'},
  ]};
  let usageReads=0;
  const account=(connection_id,provider_remaining)=>({connection_id,name:connection_id,plan:'Teste',plan_limit:120,app_limit:60,effective_limit:60,provider_limit:120,provider_remaining,observed_at:new Date().toISOString(),minutes:[],monitoring_since:new Date().toISOString()});
  t.mock.method(global,'setInterval',()=>1);t.mock.method(global,'clearInterval',()=>{});
  t.mock.method(global,'fetch',async url=>{
    if(url.endsWith('/api-usage')){usageReads++;return Response.json({available:true,generated_at:new Date().toISOString(),accounts:[account('second',50),account('first',100),account('third',110)]});}
    return Response.json(current);
  });
  await act(async()=>root.render(React.createElement(AnalyticsConnections,{key:'healthy-accounts'})));
  const cards=[...document.querySelectorAll('article')];assert.equal(cards.length,3);
  assert.equal(usageReads,1);
  for(const card of cards){assert.match(card.textContent,/Conectada/);assert.equal(card.querySelectorAll('section[aria-label="Consumo da API Olist"]').length,1);assert.doesNotMatch(card.textContent,/Reconectar esta conta|Autorizar esta conta|Restabelecer vínculo operacional/);}
  assert.match(cards[0].textContent,/20\/120/);assert.doesNotMatch(cards[0].textContent,/70\/120/);
  assert.match(cards[1].textContent,/70\/120/);assert.match(cards[2].textContent,/10\/120/);
  assert.equal(document.querySelectorAll('a[href*="oauth/login"]').length,0);
});

test("quantity analysis discloses missing CMV while product details omit scope and composition notes", async t => {
  dom.window.history.replaceState(null,"","/analytics/abc");
  const row={...rows[0],entityId:"composition:ACBF000-K050",sku:"ACBF000-K050",quantity:"2",revenue:"0"};
  const composition={version:"test-cost",revenuePolicy:"cost",costSource:{kind:"olist",name:"Olist 1",field:"precos.precoCusto",lastSyncedAt:"2026-10-20T12:00:00Z"},originalRevenue:"10000",unallocatedRevenue:"10000",unallocatedLines:1,mixedLines:1,missingCostSkus:["ACFS000-K001"],mappedEntities:1,pendingTotal:0,pending:[]};
  t.mock.method(global,"fetch",async(url)=>Response.json(url.includes("options")||url.endsWith("/sync")?state:url.includes("drilldown")?{
    total:1,companies:[],channels:[],orders:[],sources:[{sku:"ACTM011-K011",name:"Kit",factor:"1",quantity:"2",baseQuantity:"2",revenue:"0",originalRevenue:"10000",referenceCostCents:"500",unallocatedLines:1}],
  }:{rows:[row],total:1,revenue:"0",quantity:"2",orders:1,classes:{},pareto:[row],top10:100,generatedAt:"2026-10-19",composition}));
  await act(async()=>root.render(React.createElement(ABCDashboard,{key:"missing-cmv",isAdmin:true})));
  assert.match(document.querySelector('[role="alert"]').textContent,/Rateio incompleto.*ACFS000-K001/);
  assert.match(document.body.textContent,/Valor atribuído aos produtos/);
  assert.match(document.body.textContent,/CMV de refer.ncia: Olist 1.*atualizado automaticamente/);
  await click(button("Produto 0"));
  const detail=document.querySelector("dialog").textContent;
  assert.doesNotMatch(detail,/Escopo atual|Origem da composição|Quantidade vendida × fator|Valor original dos itens de origem:|CMV por unidade base:|rateio pendente por falta de CMV|ACTM011-K011/);
  assert.match(detail,/Por empresa/);
  assert.match(detail,/Por integração \/ canal/);
  assert.ok(document.querySelector('dialog table'));
  await click(document.querySelector('button[aria-label="Fechar detalhes"]'));
});

test("the reviewed workspace opens consolidated products for admin and operator; raw Olist view stays explicit", async t => {
  const access=require('../src/lib/access.ts');
  const catalog=require('../src/lib/analytics/data/composition-catalog.json');
  const {default:ABCPage}=require('../src/app/analytics/abc/page.tsx');
  let workspaceId=catalog.workspaceIds[0],role='operator';
  t.mock.method(access,'getAccessContext',async()=>({workspaceId,role,user:{id:'trusted-user'}}));
  for(role of ['admin','operator']) {
    const page=await ABCPage();
    const dashboard=React.Children.toArray(page.props.children).find(child=>child.type===ABCDashboard);
    assert.equal(dashboard.props.initialGrouping,'composition');
    assert.equal(dashboard.props.isAdmin,role==='admin');
  }
  workspaceId='workspace-without-reviewed-catalog';
  const other=await ABCPage();
  assert.equal(React.Children.toArray(other.props.children).find(child=>child.type===ABCDashboard).props.initialGrouping,'product');

  const calls=[];
  t.mock.method(global,'fetch',async(url,options={})=>{
    const body=options.body&&JSON.parse(options.body);calls.push({url,body});
    if(!url.endsWith('/abc'))return Response.json(state);
    return Response.json({rows:[rows[0]],total:1,revenue:'100',quantity:'1',orders:1,classes:{},pareto:[rows[0]],top10:100,generatedAt:'2026-10-19'});
  });
  await act(async()=>root.render(React.createElement(ABCDashboard,{key:'default-consolidated',isAdmin:false,initialGrouping:'composition'})));
  assert.equal(calls.find(c=>c.url.endsWith('/abc')).body.filters.grouping,'composition');
  assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').textContent,'Produtos base');
  await click(button('Produtos Olist'));
  assert.equal(calls.filter(c=>c.url.endsWith('/abc')).at(-1).body.filters.grouping,'product');
  assert.doesNotMatch(document.body.textContent,/Produtos Olist apresenta os cadastros por conta/);
  await click(button('Produtos base'));
  assert.equal(calls.filter(c=>c.url.endsWith('/abc')).at(-1).body.filters.grouping,'composition');
});

const fullReport = { rows: rows.slice(0,25), total:100, revenue:'10000', quantity:'100', orders:100, classes:{}, pareto:rows, top10:10, generatedAt:'2026-10-21T14:00:00Z' };
async function renderRedesign(t, key, report = fullReport) {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body);
    calls.push({url,body});
    if (url.endsWith('/export')) return new Response('arquivo');
    if (url.endsWith('/drilldown')) return Response.json({total:0,companies:[],channels:[],orders:[]});
    if (url.endsWith('/abc')) return Response.json({...report, rows: report.pareto.slice(((body.page || 1)-1)*body.size,(body.page || 1)*body.size)});
    return Response.json(state);
  });
  await act(async () => root.render(React.createElement(ABCDashboard, {key, isAdmin:false})));
  return calls;
}
const searchFor = async value => act(async () => {
  const input = document.getElementById('abc-table-search');
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(input, value);
  input.dispatchEvent(new window.Event('input', {bubbles:true}));
});

test('global search includes the last server page, preserves ranking and chart, and paginates all matches locally', async t => {
  const calls = await renderRedesign(t, 'global-search');
  const chart = document.querySelector('svg[role="img"]');
  const before = calls.filter(call => call.url.endsWith('/abc')).length;
  await searchFor('SKU-99');
  const table = document.querySelector('section[aria-label="Ranking ABC"] table');
  assert.equal(table.querySelectorAll('tbody tr').length,1);
  assert.match(table.textContent,/Produto 99/);
  assert.equal(table.querySelector('tbody td').textContent,'100');
  assert.match(table.textContent,/Classe C/);
  assert.equal(document.querySelector('svg[role="img"]'),chart);
  assert.equal(calls.filter(call => call.url.endsWith('/abc')).length,before);
  await searchFor('Produto');
  await click(document.querySelector('[aria-label="Próxima página"]'));
  assert.match(table.querySelector('tbody').textContent,/Produto 25/);
  assert.equal(calls.filter(call => call.url.endsWith('/abc')).length,before);
  await searchFor('registro inexistente');
  assert.match(document.body.textContent,/Nenhum resultado para esta busca/);
  await click(document.querySelector('[aria-label="Limpar busca"]'));
  assert.equal(table.querySelectorAll('tbody tr').length,25);
});

test('incomplete legacy ranking disables search instead of silently searching only loaded records', async t => {
  await renderRedesign(t, 'incomplete-ranking', {...fullReport,pareto:rows.slice(0,60)});
  assert.equal(document.getElementById('abc-table-search').disabled,true);
  assert.match(document.body.textContent,/servidor retornou um ranking incompleto/);
});

test('mode tabs support keyboard and customer view hides SKU without removing product columns', async t => {
  const calls = await renderRedesign(t, 'keyboard-tabs');
  await act(async () => document.getElementById('abc-tab-product').dispatchEvent(new window.KeyboardEvent('keydown',{key:'End',bubbles:true})));
  assert.equal(document.activeElement.id,'abc-tab-customer');
  assert.equal(document.querySelector('[role="tab"][aria-selected="true"]').textContent,'Clientes');
  assert.equal(calls.filter(call => call.url.endsWith('/abc')).at(-1).body.filters.grouping,'customer');
  assert.doesNotMatch(document.querySelector('section[aria-label="Ranking ABC"] thead').textContent,/SKU/);
  await click(button('Produtos Olist'));
  assert.match(document.querySelector('section[aria-label="Ranking ABC"] thead').textContent,/SKU/);
});

test('export respects applied filters while drafts and table search stay independent; success is announced', async t => {
  const calls = await renderRedesign(t, 'export-applied');
  const applied = calls.find(call => call.url.endsWith('/abc')).body.filters;
  await click(button('Últimos 7 dias'));
  assert.match(document.body.textContent,/Alterações não aplicadas/);
  await searchFor('SKU-99');
  t.mock.method(URL, 'createObjectURL', () => 'blob:abc');
  t.mock.method(URL, 'revokeObjectURL', () => {});
  t.mock.method(window.HTMLAnchorElement.prototype, 'click', () => {});
  document.querySelector('details:has([aria-label="Exportar relatório completo"])').open = true;
  await click(button('CSV completo'));
  assert.deepEqual(calls.find(call => call.url.endsWith('/export')).body,{filters:applied,format:'csv'});
  assert.match(document.body.textContent,/CSV pronto. Download iniciado/);
  await click(button('Excel'));
  assert.match(document.body.textContent,/Excel pronto. Download iniciado/);
  await click(button('Analisar vendas'));
  assert.doesNotMatch(document.body.textContent,/Alterações não aplicadas/);
  assert.notEqual(calls.filter(call => call.url.endsWith('/abc')).at(-1).body.filters.from,applied.from);
});

test('clearing selections preserves unapplied dates and restores the default order statuses', async t => {
  const calls = await renderRedesign(t, 'clear-selections');
  await click(button('Mais filtros'));
  const company = [...document.querySelectorAll('label')].find(label => label.textContent === 'Empresa 1');
  await click(company.querySelector('input'));
  await click(button('Analisar vendas'));
  const applied = calls.filter(call => call.url.endsWith('/abc')).at(-1).body.filters;
  assert.deepEqual(applied.selections.companies,['1']);
  await click(button('Últimos 7 dias'));
  await click(button('Limpar seleções'));
  const cleared = calls.filter(call => call.url.endsWith('/abc')).at(-1).body.filters;
  assert.equal(cleared.from,applied.from);
  assert.equal(cleared.selections.companies,undefined);
  assert.deepEqual(cleared.selections.statuses,['1','5','6']);
  assert.match(document.body.textContent,/Alterações não aplicadas/);
});

test('export disables both formats while pending and exposes a retry after failure without hiding report errors', async t => {
  await renderRedesign(t, 'pending-export');
  let complete;
  t.mock.method(global,'fetch',async url=>url.endsWith('/export')
    ? new Promise(resolve=>{complete=resolve;})
    : Response.json({error:'Falha de atualização'},{status:503}));
  document.querySelector('details:has([aria-label="Exportar relatório completo"])').open=true;
  await click(button('CSV completo'));
  assert.equal(button('Excel').disabled,true);
  assert.equal(button('CSV completo').disabled,true);
  assert.match(document.body.textContent,/Preparando arquivo/);
  await act(async()=>complete(Response.json({error:'Falha de exportação'},{status:503})));
  assert.equal(button('Excel').disabled,false);
  assert.match(document.querySelector('[role="alert"]').textContent,/Falha de exportação/);
  await click(button('Atualizar'));
  const alerts=[...document.querySelectorAll('[role="alert"]')].map(element=>element.textContent).join(' ');
  assert.match(alerts,/Falha de exportação/);
  assert.match(alerts,/Falha de atualização/);
});
