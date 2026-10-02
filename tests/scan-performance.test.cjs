require('./setup.cjs');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { useScanStore: store } = require('../src/stores/scan-store.ts');
const sessionId = '20000000-0000-4000-8000-000000000001';
const order = id => ({ id, trackingCode: `CODE${id}`, clientName: `Cliente ${id}`, status: 'pending', dataCriacao: null });
const session = (orders = [order(1), order(2)]) => ({ id: sessionId, orders, revision: 0, status: 'active', responsible: 'Equipe', batch_id: null });
const confirmation = (revision, scannedCount, totalCount = 2) => ({ sessionId, revision, scannedCount, totalCount });
const success = (id, revision, totalCount = 2) => ({ result: { type: 'success', message: '✓', order: { ...order(id), status: 'checked', scannedAt: '2026-10-02T12:00:00.000Z' } }, confirmation: confirmation(revision, revision, totalCount) });
afterEach(() => store.getState().reset());

test('confirmation frees the next scan immediately, keeps unchanged references and completes after the last save', async t => {
  store.getState().setSession(session());
  const untouched = store.getState().orders[1];
  let resolve, calls = 0;
  t.mock.method(global, 'fetch', async (_url, options) => {
    const { code, revision } = JSON.parse(options.body);
    if (++calls === 1) {
      assert.equal(code, 'CODE1'); assert.equal(revision, 0);
      return new Promise(done => { resolve = done; });
    }
    assert.equal(code, 'CODE2'); assert.equal(revision, 1);
    return Response.json(success(2, 2));
  });
  const pending = store.getState().submitBarcode('CODE1');
  assert.equal(store.getState().busy, true); assert.equal(store.getState().scannedCount, 0);
  await store.getState().submitBarcode('CODE2'); assert.equal(calls, 1);
  resolve(Response.json(success(1, 1))); await pending;
  assert.equal(store.getState().state, 'success'); assert.equal(store.getState().busy, false);
  assert.equal(store.getState().orders[1], untouched); assert.equal(store.getState().progress, 50);
  // The success popup is still visible. No acknowledgment or two-second wait is needed.
  await store.getState().submitBarcode('CODE2');
  assert.equal(calls, 2); assert.equal(store.getState().state, 'complete'); assert.equal(store.getState().progress, 100);
});

test('stale snapshot synchronizes other scans and tracking; legacy full responses remain supported', async t => {
  store.getState().setSession(session());
  const saved = { ...session(), revision: 3, orders: [{ ...order(1), status: 'checked' }, { ...order(2), status: 'checked', trackingCode: 'UPDATED' }] };
  t.mock.method(global, 'fetch', async () => Response.json({ session: saved, result: { type: 'success', order: saved.orders[1] } }));
  await store.getState().submitBarcode('UPDATED');
  assert.equal(store.getState().state, 'complete'); assert.equal(store.getState().revision, 3);
  assert.equal(store.getState().orders[1].trackingCode, 'UPDATED'); assert.equal(store.getState().scannedCount, 2);
});

test('finishing one request cannot clear the busy state of the next request', async t => {
  store.getState().setSession(session());
  let calls = 0, resolveNext, next;
  t.mock.method(global, 'fetch', async () => ++calls === 1
    ? Response.json(success(1, 1))
    : new Promise(resolve => { resolveNext = resolve; }));
  const unsubscribe = store.subscribe((current, previous) => {
    if (previous.busy && !current.busy && current.state === 'success') next = current.submitBarcode('CODE2');
  });
  t.after(unsubscribe);
  await store.getState().submitBarcode('CODE1');
  assert.equal(calls, 2); assert.equal(store.getState().busy, true);
  resolveNext(Response.json(success(2, 2))); await next;
  assert.equal(store.getState().busy, false); assert.equal(store.getState().state, 'complete');
});

test('network and duplicate errors pause scans without falsely marking checked or being dismissed by success', async t => {
  store.getState().setSession(session());
  let calls = 0;
  t.mock.method(global, 'fetch', async () => { calls++; throw new Error('Sem conexão'); });
  await store.getState().submitBarcode('CODE1');
  assert.equal(store.getState().state, 'error'); assert.equal(store.getState().busy, false);
  assert.equal(store.getState().orders[0].status, 'pending');
  store.getState().acknowledgeSuccess(); assert.equal(store.getState().state, 'error');
  await store.getState().submitBarcode('CODE2'); assert.equal(calls, 1);
  store.getState().acknowledgeError();
  t.mock.method(global, 'fetch', async () => Response.json({ confirmation: confirmation(0, 0), result: { type: 'error', message: 'Duplicado' } }));
  await store.getState().submitBarcode('CODE1');
  assert.equal(store.getState().state, 'error'); assert.equal(store.getState().scannedCount, 0);
});

test('late scan responses cannot update a switched session and tracking refresh survives compact confirmations', async t => {
  store.getState().setSession(session());
  let resolve;
  t.mock.method(global, 'fetch', () => new Promise(done => { resolve = done; }));
  const pending = store.getState().submitBarcode('CODE1');
  const version = store.getState().sessionVersion;
  store.getState().setSession({ ...session([order(3)]), id: '20000000-0000-4000-8000-000000000002' });
  resolve(Response.json(success(1, 1))); await pending;
  assert.equal(store.getState().orders[0].id, 3); assert.equal(store.getState().scannedCount, 0);
  store.getState().setSession(session([order(1), { ...order(2), trackingCode: '' }]));
  const next = store.getState().submitBarcode('CODE1');
  store.getState().updateTrackingCodes([{ id: 2, trackingCode: 'NEW' }], store.getState().sessionVersion);
  resolve(Response.json(success(1, 1))); await next;
  assert.equal(store.getState().orders[1].trackingCode, 'NEW');
  assert.ok(store.getState().sessionVersion > version);
});

test('large batches render only one page of orders', () => {
  const fs = require('node:fs');
  const ts = require('typescript');
  require.extensions['.tsx'] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    module._compile(outputText, filename);
  };
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { OrderList } = require('../src/components/scanner/order-list.tsx');
  const html = renderToStaticMarkup(React.createElement(OrderList, { orders: Array.from({ length: 1000 }, (_, i) => order(i + 1)) }));
  assert.equal((html.match(/Cliente /g) || []).length, 100);
  assert.match(html, /1–100 de 1000 pedidos/); assert.match(html, /Próxima/);
});
