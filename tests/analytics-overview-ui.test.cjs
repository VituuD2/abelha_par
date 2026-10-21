require('./setup.cjs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/analytics/abc' });
global.window = dom.window; global.document = dom.window.document; global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
require('./dom-setup.cjs')(dom.window);
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const originalLoad = Module._load;
Module._load = function (name, ...args) { if (name === 'next/link') return ({ children, ...props }) => React.createElement('a', props, children); return originalLoad.call(this, name, ...args); };
const { ABCDashboard } = require('../src/components/analytics/abc-dashboard.tsx');
const { ABCOverview } = require('../src/components/analytics/abc-overview.tsx');
const { previousPeriod } = require('../src/lib/analytics/comparison.ts');
Module._load = originalLoad;
const root = createRoot(document.getElementById('app'));
after(async () => { await act(async () => root.unmount()); dom.window.close(); });

const rows = Array.from({ length: 100 }, (_, i) => ({ entityId: 'product-' + i, name: 'Produto ' + i, sku: '000' + i, revenue: '150', quantity: '1', orders: 1, rank: i + 1, class: i < 80 ? 'A' : i < 95 ? 'B' : 'C', percent: 1, cumulativeBefore: i, cumulative: i + 1 }));
const result = { rows, total: 100, revenue: '15000', quantity: '100', orders: 100, top10: 10, pareto: rows, generatedAt: '2026-10-21T12:00:00Z', classes: { A: { count: 80, revenue: '12000', quantity: '80', percent: 80 }, B: { count: 15, revenue: '2250', quantity: '15', percent: 15 }, C: { count: 5, revenue: '750', quantity: '5', percent: 5 } } };
const previous = { revenue: '10000', quantity: '125', orders: 80, total: 50, top10: 20 };
const status = () => ({ companies: [{ id: 'co', name: 'Empresa' }], connections: [{ id: 'c', company_id: 'co', name: 'Olist', enabled: true, verified_at: '2026-01-01' }], sources: [], coverage: [{ connection_id: 'c', mode: 'backfill', status: 'completed', from_date: '2020-01-01', to_date: '2100-01-01' }], jobs: [], options: {} });
const button = text => [...document.querySelectorAll('button')].find(el => el.textContent === text);
const click = element => act(async () => element.click());
const render = key => act(async () => root.render(React.createElement(ABCDashboard, { key, isAdmin: false })));
const panel = () => document.querySelector('section[aria-label="Indicadores do período"]');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function captureAnimations(t) {
  const prototype = dom.window.HTMLElement.prototype;
  const original = Object.getOwnPropertyDescriptor(prototype, 'animate');
  const animations = [];
  Object.defineProperty(prototype, 'animate', { configurable: true, value(frames, options) {
    animations.push({ text: this.textContent, frames, options });
    return { cancel() {} };
  } });
  t.after(() => { if (original) Object.defineProperty(prototype, 'animate', original); else delete prototype.animate; });
  return animations;
}
function mockRequests(t, options = {}) {
  const calls = [], currentStatus = options.status || status();
  t.mock.method(global, 'fetch', async (url, init = {}) => {
    const body = init.body && JSON.parse(init.body); calls.push({ url, body, signal: init.signal });
    if (url.endsWith('/comparison')) return options.comparison ? options.comparison(body, init) : Response.json({ period: previousPeriod(body.filters), previous });
    if (url.endsWith('/coverage')) return Response.json({ sync: { scheduled: 0 } });
    if (url.endsWith('/abc')) return options.report ? options.report(body, init) : Response.json({ ...result, rows: rows.slice(((body.page || 1) - 1) * body.size, (body.page || 1) * body.size) });
    return options.statusResponse ? options.statusResponse() : Response.json(currentStatus);
  });
  return calls;
}

test('integrated panels preserve KPI and class values, real variations, independent compound counts and neutral Top 10 semantics', async t => {
  const calls = mockRequests(t);
  await render('overview');
  assert.equal(calls.filter(call => call.url.endsWith('/comparison')).length, 1);
  const kpis = panel();
  assert.doesNotMatch(kpis.textContent, /Período anterior:|mesma duração|Mesmos filtros e critérios/);
  assert.equal(kpis.querySelectorAll('h2').length, 4);
  assert.match(kpis.textContent, /R\$\s*150,00/);
  const badges = [...kpis.querySelectorAll('[data-trend-direction]')];
  assert.equal(badges.length, 5);
  assert.deepEqual(badges.map(b => b.dataset.trendDirection), ['up', 'down', 'up', 'up', 'down']);
  assert.deepEqual(badges.map(b => b.dataset.trendTone), ['up', 'down', 'up', 'up', 'neutral']);
  assert.match(badges[0].textContent, /\+50%/); assert.match(badges[1].textContent, /−20%/);
  assert.match(badges[2].textContent, /Pedidos \+25%/); assert.match(badges[3].textContent, /Entidades \+100%/);
  assert.match(badges[4].title, /não indica.*melhora ou piora/);
  assert.doesNotMatch(kpis.textContent, /vs\. período anterior/);
  const period = previousPeriod(calls.find(call => call.url.endsWith('/comparison')).body.filters);
  const range = `${period.from.split('-').reverse().join('/')} a ${period.to.split('-').reverse().join('/')}`;
  const info = kpis.querySelectorAll('button[aria-label^="Período comparado:"]');
  assert.equal(info.length, 4);
  for (const button of info) assert.equal(button.title, range);
  assert.equal(kpis.querySelectorAll('svg[aria-hidden="true"]').length, 13);
  const classes = document.querySelector('section[aria-label="Resumo das classes ABC"]');
  assert.equal(classes.querySelectorAll('h3').length, 3);
  assert.equal(classes.querySelectorAll('.card').length, 0);
  const bar = classes.querySelector('[role="img"]');
  assert.match(bar.getAttribute('aria-label'), /Classe A: 80%; Classe B: 15%; Classe C: 5%/);
  assert.deepEqual([...bar.children].map(el => el.style.width), ['80%', '15%', '5%']);
  assert.match(classes.textContent, /80 produtos/); assert.match(classes.textContent, /80 unidades/);
});

test('sorting, paging and local search reuse the previous summary; refreshing and changing applied grouping read it once again', async t => {
  const calls = mockRequests(t); await render('reuse');
  const count = () => calls.filter(call => call.url.endsWith('/comparison')).length;
  assert.equal(count(), 1);
  await click(button('Valor bruto')); await click(document.querySelector('[aria-label="Próxima página"]'));
  assert.equal(count(), 1);
  const input = document.getElementById('abc-table-search');
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'Produto 99'); input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  assert.equal(count(), 1);
  await click(button('Atualizar')); assert.equal(count(), 2);
  await click(button('Clientes')); assert.equal(count(), 3);
  const last = calls.filter(call => call.url.endsWith('/comparison')).at(-1);
  assert.equal(last.body.filters.grouping, 'customer');
  assert.equal(last.body.page, undefined);
});

test('partial coverage and unfinished or failed syncs still compare available data and preserve scope notices', async t => {
  const to = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const from = new Date(Date.parse(to + 'T12:00:00Z') - 29 * 86400000).toISOString().slice(0, 10);
  const partial = status(); partial.coverage[0].from_date = from;
  const calls = mockRequests(t, { status: partial }); await render('partial');
  assert.equal(calls.filter(call => call.url.endsWith('/comparison')).length, 1);
  assert.equal(panel().querySelectorAll('[data-trend-direction]').length, 5);
  assert.equal(document.querySelectorAll('tbody tr').length, 25);
  const missingCurrent = status(); missingCurrent.coverage = [];
  missingCurrent.connections[0].last_error = 'Sincronização pendente';
  missingCurrent.jobs = [{ connection_id: 'c', mode: 'backfill', status: 'running', from_date: '2020-01-01', to_date: '2100-01-01' }];
  missingCurrent.costSync = { connection_id: 'c', page_offset: 100, last_synced_at: null, last_error: 'CMV pendente', history: { pending: 2 } };
  const currentCalls = mockRequests(t, { status: missingCurrent }); await render('missing-current');
  assert.equal(currentCalls.filter(call => call.url.endsWith('/comparison')).length, 1);
  assert.equal(panel().querySelectorAll('[data-trend-direction]').length, 5);
  assert.match(document.body.textContent, /Escopo parcial/);
  await click(button('Produtos base'));
  assert.equal(currentCalls.filter(call => call.url.endsWith('/comparison')).length, 2);
  assert.equal(panel().querySelectorAll('[data-trend-direction]').length, 5);
});

test('comparison reads do not wait for coverage or synchronization status to load', async t => {
  const pendingStatus = deferred();
  const calls = mockRequests(t, { statusResponse: async () => { await pendingStatus.promise; return Response.json(status()); } });
  await render('status-loading');
  assert.equal(calls.filter(call => call.url.endsWith('/comparison')).length, 1);
  assert.equal(panel().querySelectorAll('[data-trend-direction]').length, 5);
  assert.equal(document.querySelectorAll('tbody tr').length, 25);
  await act(async () => pendingStatus.resolve());
  assert.equal(calls.filter(call => call.url.endsWith('/comparison')).length, 1);
});

test('pending comparisons leave current values visible; obsolete success and errors are ignored after filters change', async t => {
  const old = deferred(), next = deferred(); let queries = 0;
  const calls = mockRequests(t, { comparison: () => ++queries === 1 ? old.promise : next.promise });
  await render('race');
  assert.doesNotMatch(panel().textContent, /Calculando variação/);
  assert.equal(panel().querySelector('[data-trend-direction]'), null);
  await click(button('Clientes'));
  assert.equal(calls.filter(call => call.url.endsWith('/comparison'))[0].signal.aborted, true);
  await act(async () => next.resolve(Response.json({ period: { from: '2026-09-01', to: '2026-09-30' }, previous })));
  assert.equal(panel().querySelectorAll('[data-trend-direction]').length, 5);
  await act(async () => old.resolve(Response.json({ period: {}, previous: { ...previous, revenue: '1' } })));
  assert.match(panel().querySelector('[data-trend-direction]').textContent, /\+50%/);
  const failure = deferred();
  mockRequests(t, { comparison: () => failure.promise }); await render('race-error');
  const latestCalls = mockRequests(t); await click(button('Clientes'));
  await act(async () => failure.reject(new Error('Erro obsoleto')));
  assert.doesNotMatch(panel().textContent, /Erro obsoleto/);
  assert.equal(latestCalls.filter(call => call.url.endsWith('/comparison')).length, 1);
});

test('comparison errors are isolated from the report and recover on refresh', async t => {
  let attempt = 0;
  mockRequests(t, { comparison: body => ++attempt === 1 ? Response.json({ error: 'Histórico indisponível' }, { status: 503 }) : Response.json({ period: previousPeriod(body.filters), previous }) });
  await render('retry'); assert.match(panel().querySelector('[role="status"]').title, /Histórico indisponível/);
  assert.equal(panel().querySelector('[data-trend-direction]'), null);
  assert.match(panel().textContent, /R\$\s*150,00/);
  assert.equal(document.querySelector('[role="alert"]'), null);
  await click(button('Atualizar'));
  assert.equal(panel().querySelectorAll('[data-trend-direction]').length, 5);
});

test('applied-filter requests retain the displayed values and trends until both responses finish, then animate the actual change', async t => {
  mockRequests(t); await render('animated-values');
  const values = () => [...panel().querySelectorAll('[data-kpi-value]')].map(el => el.textContent);
  const trends = () => [...panel().querySelectorAll('[data-trend-direction]')].map(el => el.textContent);
  const beforeValues = values(), beforeTrends = trends();
  const oldRange = panel().querySelector('button[aria-label^="Período comparado:"]').title;
  const animations = captureAnimations(t);
  const currentRequest = deferred(), comparisonRequest = deferred();
  let period;
  mockRequests(t, { report: () => currentRequest.promise, comparison: body => { period = previousPeriod(body.filters); return comparisonRequest.promise; } });
  await click(button('Últimos 7 dias')); await click(button('Analisar vendas'));
  assert.deepEqual(values(), beforeValues); assert.deepEqual(trends(), beforeTrends);
  assert.doesNotMatch(panel().textContent, /Calculando variação/);
  assert.equal(panel().querySelector('button[aria-label^="Período comparado:"]').title, oldRange);
  const updated = { ...result, revenue: '20000', quantity: '50', orders: 120, top10: 5 };
  await act(async () => currentRequest.resolve(Response.json(updated)));
  assert.deepEqual(values(), beforeValues); assert.deepEqual(trends(), beforeTrends);
  assert.equal(animations.length, 0);
  await act(async () => comparisonRequest.resolve(Response.json({ period, previous })));
  assert.deepEqual(values(), ['R$ 200,00', '50', '120 / 100', '5%']);
  assert.match(panel().querySelector('[data-trend-direction]').textContent, /\+100%/);
  assert.equal(animations.find(item => item.text === 'R$ 200,00').frames[0].transform, 'translateY(7px)');
  assert.equal(animations.find(item => item.text === '50').frames[0].transform, 'translateY(-7px)');
  assert.equal(animations.find(item => item.text === '5%').frames[0].transform, 'translateY(-7px)');
  assert.equal(animations.find(item => item.text === '+100%').frames[0].transform, 'translateY(7px)');
  assert.ok(animations.every(item => item.options.duration === 220));
  assert.notEqual(panel().querySelector('button[aria-label^="Período comparado:"]').title, oldRange);
  animations.length = 0;
  mockRequests(t, { report: () => Response.json(updated) }); await click(button('Atualizar'));
  assert.equal(animations.length, 0, 'unchanged numbers do not animate');
  const laterCurrent = deferred(), updatedPrevious = { ...previous, revenue: '5000' };
  mockRequests(t, { report: () => laterCurrent.promise, comparison: body => Response.json({ period: previousPeriod(body.filters), previous: updatedPrevious }) });
  await click(button('Atualizar'));
  assert.deepEqual(values(), ['R$ 200,00', '50', '120 / 100', '5%']);
  assert.match(panel().querySelector('[data-trend-direction]').textContent, /\+100%/);
  assert.equal(animations.length, 0, 'an early comparison response does not replace the visible pair');
  await act(async () => laterCurrent.resolve(Response.json(updated)));
  assert.match(panel().querySelector('[data-trend-direction]').textContent, /\+300%/);
});

test('period info exposes only the exact date range and number transitions respect reduced motion', async t => {
  const animations = captureAnimations(t);
  t.mock.method(dom.window, 'matchMedia', query => ({ matches: query === '(prefers-reduced-motion: reduce)', media: query, addEventListener() {}, removeEventListener() {} }));
  const filters = { from: '2026-10-15', to: '2026-10-21', metric: 'revenue', grouping: 'product', mode: 'TINY_LEGACY', basis: 'orders', thresholdA: 80, thresholdB: 95, selections: {} };
  const comparison = { data: { period: previousPeriod(filters), previous }, loading: false, message: null };
  const overview = current => act(async () => root.render(React.createElement(ABCOverview, { key: 'reduced-motion', result: current, filters, comparison, loading: false })));
  await overview(result);
  assert.equal(panel().querySelector('button[aria-label^="Período comparado:"]').title, '08/10/2026 a 14/10/2026');
  await overview({ ...result, revenue: '20000' });
  assert.match(panel().querySelector('[data-kpi-value]').textContent, /200,00/);
  assert.equal(animations.length, 0);
});

test('zero or missing classes, zero baselines, incomplete allocation and negative participation remain explicit', async () => {
  const filters = { from: '2026-10-01', to: '2026-10-21', metric: 'quantity', grouping: 'composition', mode: 'TINY_LEGACY', basis: 'orders', thresholdA: 80, thresholdB: 95, selections: {} };
  const renderOverview = (current, old = previous, extra = {}) => act(async () => root.render(React.createElement(ABCOverview, { result: current, filters, comparison: { data: { period: previousPeriod(filters), previous: old }, loading: false, message: null }, loading: false, ...extra })));
  await renderOverview({ ...result, classes: null }, { ...previous, revenue: '0', quantity: '0', orders: 0, total: 0, top10: 0 });
  assert.equal(document.querySelector('[data-trend-direction]'), null);
  assert.match(panel().textContent, /Sem base anterior/);
  assert.equal(document.querySelector('[aria-label="Sem distribuição proporcional disponível"]').children.length, 0);
  await renderOverview({ ...result, composition: { unallocatedLines: 1, costMissingLines: 1 } }, { ...previous, costIncomplete: true });
  assert.equal(panel().querySelectorAll('[data-trend-direction]').length, 5);
  assert.match(panel().querySelector('[data-trend-direction]').textContent, /\+50%/);
  assert.doesNotMatch(panel().textContent, /sem rateio|Período anterior:/);
  await renderOverview(result, { ...previous, revenue: null });
  assert.equal(panel().querySelectorAll('[data-trend-direction]').length, 4);
  assert.match(panel().textContent, /Indisponível/);
  await renderOverview({ ...result, classes: { A: { ...result.classes.A, percent: 105 }, B: { ...result.classes.B, percent: -5 } } });
  assert.match(document.body.textContent, /não representa participações negativas/);
  assert.equal(document.querySelector('[aria-label="Sem distribuição proporcional disponível"]').children.length, 0);
  await renderOverview(result, { ...previous, revenue: '-10000', top10: 10 });
  assert.equal(panel().querySelector('[data-trend-direction="up"]').dataset.trendTone, 'neutral');
  assert.match(panel().querySelector('[data-trend-direction="flat"]').textContent, /0%/);
  await renderOverview(result, previous, { loading: true });
  assert.equal(panel().getAttribute('aria-busy'), 'true');
  assert.equal(panel().querySelectorAll('[data-trend-direction]').length, 5);
  await renderOverview({ ...result, revenue: '0', quantity: '0', orders: 0, total: 0, top10: 0, classes: null });
  assert.equal(panel().querySelectorAll('[data-trend-direction="down"]').length, 5);
  assert.match(panel().querySelector('[data-trend-direction]').textContent, /−100%/);
});
