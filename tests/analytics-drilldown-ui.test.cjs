require('./setup.cjs');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/analytics/abc' });
global.window = dom.window;
global.document = dom.window.document;
global.IS_REACT_ACT_ENVIRONMENT = true;
require('./dom-setup.cjs')(dom.window);
window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
require.extensions['.tsx'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText, filename);
const React = require('react'), { act } = React, { createRoot } = require('react-dom/client');
const originalLoad = Module._load;
Module._load = function (name, ...args) { return name === 'next/link' ? ({ children, ...props }) => React.createElement('a', props, children) : originalLoad.call(this, name, ...args); };
const { ABCDashboard } = require('../src/components/analytics/abc-dashboard.tsx');
Module._load = originalLoad;
const root = createRoot(document.getElementById('app'));
after(async () => { await act(async () => root.unmount()); dom.window.close(); });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const click = element => act(async () => element.click());
const modal = () => document.querySelector('dialog');
const button = name => [...modal().querySelectorAll('button')].find(button => button.textContent === name);
const currentPage = () => modal().querySelector('select').value;
const openProduct = id => click(document.querySelector(`tr[data-abc-entity="${id}"]`));
const close = () => click(modal().querySelector('[aria-label="Fechar detalhes"]'));
const rows = ['A', 'B'].map((id, index) => ({ entityId: id, name: `Produto ${id}`, sku: id, rank: index + 1, revenue: '100', quantity: '1', orders: 125, percent: 50, cumulativeBefore: index * 50, cumulative: (index + 1) * 50, class: 'A' }));
const result = { rows, total: 2, revenue: '200', quantity: '2', orders: 250, classes: {}, pareto: rows, top10: 100, generatedAt: '2026-10-20' };
const data = (entity, page) => ({
  total: 125,
  companies: [{ name: `Empresa ${entity}`, revenue: '12500', quantity: '125', orders: 125 }],
  channels: [{ name: 'Canal de venda', revenue: '12500', quantity: '125', orders: 125 }],
  orders: Array.from({ length: Math.min(50, 125 - (page - 1) * 50) }, (_, index) => ({
    id: `${entity}-${(page - 1) * 50 + index + 1}`, number: `${entity}-PED-${(page - 1) * 50 + index + 1}`,
    date: '2026-09-15', status: 6, company: `Empresa ${entity}`, source: 'Canal de venda', connection: entity, revenue: '100', quantity: '1',
  })),
});
function mockAPI(t, respond) {
  const calls = [];
  t.mock.method(global, 'fetch', async (url, options = {}) => {
    const body = options.body && JSON.parse(options.body);
    if (url.endsWith('/drilldown')) { calls.push({ ...body, signal: options.signal }); return respond(body); }
    return Response.json(url.endsWith('/abc') ? result : url.endsWith('/coverage') ? { sync: { scheduled: 0 } } : { companies: [], connections: [], jobs: [], options: {} });
  });
  return calls;
}
const render = key => act(async () => root.render(React.createElement(ABCDashboard, { key, isAdmin: false })));

test('direct page selection, previous and next preserve the existing orders and totals until new data arrives', async t => {
  const first = deferred(), pages = [];
  const calls = mockAPI(t, body => {
    if (calls.length === 1) return first.promise;
    const pending = deferred(); pages.push({ ...pending, page: body.page }); return pending.promise;
  });
  await render('pagination');
  await openProduct('A');
  assert.ok(modal().querySelector('[data-loading-placeholder] .skeleton'));
  await act(async () => first.resolve(Response.json(data('A', 1))));
  const table = modal().querySelector('table');
  assert.equal(currentPage(), '1');
  assert.equal(button('Anterior').disabled, true);
  await click(modal().querySelector('.app-select-trigger'));
  const menu = document.querySelector('[role="listbox"]');
  assert.equal(menu.closest('dialog'), modal(), 'the custom menu must stay inside the native dialog top layer');
  assert.deepEqual([...menu.querySelectorAll('[role="option"]')].map(option => option.textContent), ['1', '2', '3']);
  await click(menu.querySelector('[data-key="3"]'));
  assert.equal(calls.at(-1).page, 3);
  const checkPending = (page, firstOrder, visiblePage) => {
    assert.equal(modal().querySelector('table'), table);
    assert.match(table.textContent, new RegExp(firstOrder));
    assert.match(modal().textContent, /Empresa A/);
    assert.match(modal().textContent, /125 pedidos/);
    assert.doesNotMatch(modal().textContent, /Consultando pedidos/);
    assert.ok(modal().querySelector('[data-loading-placeholder] .skeleton'));
    assert.equal(modal().querySelector('[data-loading-region]').getAttribute('aria-busy'), 'true');
    assert.equal(currentPage(), String(visiblePage));
    assert.equal(button('Anterior').hasAttribute('inert'), true);
    assert.equal(button('Próxima').hasAttribute('inert'), true);
    assert.equal(modal().querySelector('.app-select-trigger').hasAttribute('inert'), true);
  };
  checkPending(3, 'A-PED-1', 1);
  await act(async () => pages.at(-1).resolve(Response.json(data('A', 3))));
  assert.equal(currentPage(), '3');
  assert.equal(table.querySelectorAll('tbody tr').length, 25);
  assert.match(table.textContent, /A-PED-101/);
  assert.equal(button('Próxima').disabled, true);
  await click(button('Anterior'));
  checkPending(2, 'A-PED-101', 3);
  await act(async () => pages.at(-1).resolve(Response.json(data('A', 2))));
  assert.equal(currentPage(), '2');
  assert.match(table.textContent, /A-PED-51/);
  await click(button('Próxima'));
  checkPending(3, 'A-PED-51', 2);
  await act(async () => pages.at(-1).resolve(Response.json(data('A', 3))));
  assert.equal(currentPage(), '3');
  assert.equal(table.parentElement.getAttribute('aria-busy'), 'false');
  assert.equal(modal().querySelector('[role="status"]'), null);
  await close();
});

test('a failed page retains the displayed page and can be requested again', async t => {
  const second = deferred(); let attempts = 0;
  mockAPI(t, body => body.page === 1 ? Response.json(data('A', 1)) : ++attempts === 1 ? second.promise : Response.json(data('A', 2)));
  await render('page-error');
  await openProduct('A');
  await click(button('Próxima'));
  await act(async () => second.resolve(Response.json({ error: 'Falha temporária ao carregar pedidos.' }, { status: 503 })));
  assert.match(modal().querySelector('[role="alert"]').textContent, /Falha temporária/);
  assert.match(modal().querySelector('table').textContent, /A-PED-1/);
  assert.equal(currentPage(), '1');
  assert.equal(button('Próxima').disabled, false);
  await click(button('Próxima'));
  assert.equal(attempts, 2);
  assert.equal(currentPage(), '2');
  assert.match(modal().querySelector('table').textContent, /A-PED-51/);
  assert.equal(modal().querySelector('[role="alert"]'), null);
  await close();
});

test('closing a pending page aborts its request and a different product never displays the previous product data', async t => {
  const old = deferred(), nextProduct = deferred();
  const calls = mockAPI(t, body => body.entity === 'B' ? nextProduct.promise : body.page === 1 ? Response.json(data('A', 1)) : old.promise);
  await render('page-scope');
  await openProduct('A');
  await click(button('Próxima'));
  const pending = calls.at(-1);
  await close();
  assert.equal(pending.signal.aborted, true);
  await openProduct('B');
  assert.equal(calls.at(-1).page, 1);
  assert.equal(calls.at(-1).entity, 'B');
  assert.equal(modal().querySelector('table'), null);
  await act(async () => old.resolve(Response.json(data('A', 2))));
  assert.doesNotMatch(modal().textContent, /A-PED-|Empresa A/);
  assert.ok(modal().querySelector('[data-loading-placeholder] .skeleton'));
  await act(async () => nextProduct.resolve(Response.json(data('B', 1))));
  assert.match(modal().querySelector('table').textContent, /B-PED-1/);
  assert.equal(currentPage(), '1');
  await close();
});

test('only detail summaries order companies and integrations by descending revenue for products and customers', async t => {
  const summary = {
    ...data('A', 1),
    companies: [
      { name: 'Olist 2', revenue: '9007199254740992', quantity: '1', orders: 1 },
      { name: 'Olist 1', revenue: '9007199254740993', quantity: '1', orders: 1 },
      { name: 'Olist 3', revenue: '100', quantity: '1', orders: 1 },
    ],
    channels: [
      { name: 'Canal menor', revenue: '900', quantity: '1', orders: 1 },
      { name: 'Canal maior', revenue: '10000', quantity: '1', orders: 1 },
      { name: 'Canal negativo', revenue: '-100', quantity: '1', orders: 1 },
    ],
  };
  mockAPI(t, () => Response.json(summary));
  await render('revenue-summaries');
  for (const customer of [false, true]) {
    if (customer) await click(document.getElementById('abc-tab-customer'));
    await openProduct('A');
    const cards = [...modal().querySelectorAll('h3')].map(heading => heading.parentElement);
    const names = card => [...card.querySelectorAll('div > span:first-child')].map(span => span.textContent);
    assert.deepEqual(names(cards[0]), ['Olist 1', 'Olist 2', 'Olist 3']);
    assert.deepEqual(names(cards[1]), ['Canal maior', 'Canal menor', 'Canal negativo']);
    const orderLabels = modal().querySelectorAll(customer ? 'section[aria-label="Pedidos do cliente"] article h4' : 'tbody tr td:first-child');
    assert.deepEqual([...orderLabels].map(label => label.textContent), summary.orders.map(order => customer ? `Pedido ${order.number}` : order.number));
    await close();
    assert.deepEqual([...document.querySelectorAll('tr[data-abc-entity]')].map(row => row.dataset.abcEntity), ['A', 'B']);
  }
});
