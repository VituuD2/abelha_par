require('./setup.cjs');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { useScanStore: store } = require('../src/stores/scan-store.ts');
const sounds = require('../src/lib/sounds.ts');
const sessionId = '20000000-0000-4000-8000-000000000001';
const order = id => ({ id, trackingCode: `CODE${id}`, clientName: `Cliente ${id}`, status: 'pending', dataCriacao: null });
const session = (orders = [order(1), order(2)]) => ({ id: sessionId, orders, revision: 0, status: 'active', responsible: 'Equipe', batch_id: null });
const confirmation = (revision, scannedCount, totalCount = 2) => ({ sessionId, revision, scannedCount, totalCount });
const success = (id, revision, totalCount = 2) => ({ result: { type: 'success', message: '✓', order: { ...order(id), status: 'checked', scannedAt: '2026-10-02T12:00:00.000Z' } }, confirmation: confirmation(revision, revision, totalCount) });
afterEach(() => store.getState().reset());

test('confirmation frees the next scan immediately, keeps unchanged references and completes after the last save', async t => {
  store.getState().setSession(session());
  const feedback = [];
  t.mock.method(sounds, 'playScanConfirmation', complete => {
    // Start audio before notifying UI subscribers, after the response is parsed.
    assert.equal(store.getState().busy, true);
    feedback.push({ complete, scannedBeforeRender: store.getState().scannedCount });
  });
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
  assert.deepEqual(feedback, []);
  await store.getState().submitBarcode('CODE2'); assert.equal(calls, 1);
  resolve(Response.json(success(1, 1))); await pending;
  assert.equal(store.getState().state, 'success'); assert.equal(store.getState().busy, false);
  assert.equal(store.getState().orders[1], untouched); assert.equal(store.getState().progress, 50);
  assert.deepEqual(feedback, [{ complete: false, scannedBeforeRender: 0 }]);
  // The success popup is still visible. No acknowledgment or two-second wait is needed.
  await store.getState().submitBarcode('CODE2');
  assert.equal(calls, 2); assert.equal(store.getState().state, 'complete'); assert.equal(store.getState().progress, 100);
  assert.deepEqual(feedback, [{ complete: false, scannedBeforeRender: 0 }, { complete: true, scannedBeforeRender: 1 }]);
});

test('stale snapshot synchronizes other scans and tracking; legacy full responses remain supported', async t => {
  store.getState().setSession(session());
  const feedback = t.mock.method(sounds, 'playScanConfirmation', complete => assert.equal(complete, true));
  const saved = { ...session(), revision: 3, orders: [{ ...order(1), status: 'checked' }, { ...order(2), status: 'checked', trackingCode: 'UPDATED' }] };
  t.mock.method(global, 'fetch', async () => Response.json({ session: saved, result: { type: 'success', order: saved.orders[1] } }));
  await store.getState().submitBarcode('UPDATED');
  assert.equal(store.getState().state, 'complete'); assert.equal(store.getState().revision, 3);
  assert.equal(store.getState().orders[1].trackingCode, 'UPDATED'); assert.equal(store.getState().scannedCount, 2);
  assert.equal(feedback.mock.callCount(), 1);
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
  const feedback = t.mock.method(sounds, 'playScanConfirmation', () => {});
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
  assert.equal(feedback.mock.callCount(), 0);
});

test('late scan responses cannot update a switched session and tracking refresh survives compact confirmations', async t => {
  store.getState().setSession(session());
  const feedback = t.mock.method(sounds, 'playScanConfirmation', () => {});
  let resolve;
  t.mock.method(global, 'fetch', () => new Promise(done => { resolve = done; }));
  const pending = store.getState().submitBarcode('CODE1');
  const version = store.getState().sessionVersion;
  store.getState().setSession({ ...session([order(3)]), id: '20000000-0000-4000-8000-000000000002' });
  resolve(Response.json(success(1, 1))); await pending;
  assert.equal(store.getState().orders[0].id, 3); assert.equal(store.getState().scannedCount, 0);
  assert.equal(feedback.mock.callCount(), 0);
  store.getState().setSession(session([order(1), { ...order(2), trackingCode: '' }]));
  const next = store.getState().submitBarcode('CODE1');
  store.getState().updateTrackingCodes([{ id: 2, trackingCode: 'NEW' }], store.getState().sessionVersion);
  resolve(Response.json(success(1, 1))); await next;
  assert.equal(store.getState().orders[1].trackingCode, 'NEW');
  assert.ok(store.getState().sessionVersion > version);
  assert.equal(feedback.mock.callCount(), 1);
});

test('unavailable audio does not turn a confirmed save into a failed scan', async t => {
  store.getState().setSession(session());
  // Node has neither Web Audio nor HTML Audio, exercising both failed paths.
  assert.equal(typeof global.AudioContext, 'undefined');
  assert.equal(typeof global.Audio, 'undefined');
  t.mock.method(global, 'fetch', async () => Response.json(success(1, 1)));
  await store.getState().submitBarcode('CODE1');
  assert.equal(store.getState().state, 'success');
  assert.equal(store.getState().scannedCount, 1);
  assert.equal(store.getState().busy, false);
});

test('large batches render one page without exposing pending or checked tracking codes', () => {
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
  const orders = Array.from({ length: 1000 }, (_, i) => ({ ...order(i + 1), numeroPedido: i + 1 }));
  orders[0].status = 'checked';
  orders[2].trackingCode = '';
  const html = renderToStaticMarkup(React.createElement(OrderList, { orders }));
  assert.equal((html.match(/Cliente /g) || []).length, 100);
  assert.match(html, /1–100 de 1000 pedidos/); assert.match(html, /Próxima/);
  assert.doesNotMatch(html, /CODE\d+/);
  assert.match(html, /Olist #1/);
  assert.match(html, /Pedido sem código de rastreio/);
});
