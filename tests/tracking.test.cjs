const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
require('./setup.cjs');

const { useScanStore: store } = require('../src/stores/scan-store.ts');
const { startTrackingRefresh } = require('../src/lib/tracking-refresh.ts');
const { sanitizeOrders } = require('../src/lib/batch-orders.ts');
const { displayTrackingCode, trackingCodesMatch } = require('../src/lib/tracking.ts');
const order = (id, trackingCode = '') => ({ id, trackingCode, yampiId: String(id), clientName: `Cliente ${id}`, numeroPedido: id, dataCriacao: null, situacao: null, status: 'pending' });
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const response = (orders, status = 200, extra = {}) => new Response(JSON.stringify({ orders, ...extra }), { status });
afterEach(() => store.getState().reset());

test('late tracking preserves scans, counts, responsible, metadata and error state; then allows completion', () => {
  store.getState().setOrders([order(1, 'AA123456789BR'), order(2)], 'Operador');
  const version = store.getState().sessionVersion;
  store.getState().processBarcode('AA123456789BR');
  const checked = store.getState().orders[0];
  store.getState().processBarcode('desconhecido');
  const error = store.getState().currentResult;
  store.getState().updateTrackingCodes([order(1, 'DIFFERENT'), order(2, '  BB123456789BR  '), order(99, 'OTHER')], version);
  assert.equal(store.getState().orders[0], checked);
  assert.equal(store.getState().orders.length, 2);
  assert.equal(store.getState().orders[1].status, 'pending');
  assert.equal(store.getState().orders[1].yampiId, '2');
  assert.equal(store.getState().orders[1].trackingCode, 'BB123456789BR');
  assert.equal(store.getState().scannedCount, 1);
  assert.equal(store.getState().progress, 50);
  assert.equal(store.getState().responsible, 'Operador');
  assert.equal(store.getState().currentResult, error);
  assert.equal(store.getState().state, 'error');
  store.getState().acknowledgeError();
  store.getState().processBarcode('BB123456789BR');
  assert.equal(store.getState().state, 'complete');
  assert.equal(store.getState().progress, 100);
  assert.equal(sanitizeOrders(store.getState().orders).length, 2);
});

test('empty updates cannot replace known codes, and previous sessions cannot update a new lot', () => {
  store.getState().setOrders([order(1), order(2, 'KNOWN')], 'Operador');
  const version = store.getState().sessionVersion;
  store.getState().updateTrackingCodes([order(1, ' \t '), order(2, '')], version);
  assert.equal(store.getState().orders[1].trackingCode, 'KNOWN');
  store.getState().setOrders([order(1)], 'Outro operador');
  store.getState().updateTrackingCodes([order(1, 'LATE')], version);
  assert.equal(store.getState().orders[0].trackingCode, '');
});

test('empty tracking never matches; API rejects missing, whitespace, oversized and pending orders', () => {
  assert.equal(trackingCodesMatch('', ''), false);
  assert.equal(trackingCodesMatch(' \n ', ' '), false);
  for (const trackingCode of ['', ' \n\t ', null, undefined, ' '.repeat(201) + 'A']) {
    assert.equal(sanitizeOrders([{ ...order(1, trackingCode), trackingCode, status: 'checked' }]), null);
  }
  assert.equal(sanitizeOrders([order(1, 'KNOWN')]), null);
  assert.equal(sanitizeOrders([null]), null);
  assert.equal(sanitizeOrders([]), null);
  for (const value of ['', ' \n ', null, undefined]) assert.equal(displayTrackingCode(value), 'SEM CÓDIGO DE RASTREIO');
  assert.equal(displayTrackingCode(' AA123456789BR '), 'AA123456789BR');
});

test('refresh visits every missing order in batches and retries empty codes without interrupting scans', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  store.getState().setOrders([order(20, 'EXISTING'), ...Array.from({ length: 7 }, (_, i) => order(i + 1))], 'Operador');
  const calls = [];
  const stop = startTrackingRefresh({ getSession: store.getState, applyUpdates: (updates, version) => store.getState().updateTrackingCodes(updates, version), onError: () => {}, fetcher: async (_url, options) => {
    const ids = JSON.parse(options.body).orderIds;
    calls.push(ids);
    return response(ids.map((id) => order(id, calls.length === 1 ? '' : `CODE${id}`)));
  } });
  t.after(stop);
  await flush();
  assert.deepEqual(calls, [[1, 2, 3, 4, 5]]);
  store.getState().processBarcode('EXISTING');
  t.mock.timers.tick(5_000);
  await flush();
  assert.deepEqual(calls[1], [6, 7]);
  t.mock.timers.tick(30_000);
  await flush();
  assert.deepEqual(calls[2], [1, 2, 3, 4, 5]);
  assert.equal(store.getState().scannedCount, 1);
  assert.equal(store.getState().orders[1].trackingCode, 'CODE1');
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(calls.length, 3);
});

test('rate limit respects retry time and recovers automatically', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  store.getState().setOrders([order(1)], 'Operador');
  let calls = 0;
  const errors = [];
  const stop = startTrackingRefresh({ getSession: store.getState, applyUpdates: (updates, version) => store.getState().updateTrackingCodes(updates, version), onError: (error) => errors.push(error), fetcher: async () => ++calls === 1 ? response([], 429, { retryAfterSeconds: 120 }) : response([order(1, 'NEW')]) });
  t.after(stop);
  await flush();
  assert.match(errors[0], /limitou/);
  t.mock.timers.tick(119_999);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 2);
  assert.equal(store.getState().orders[0].trackingCode, 'NEW');
  assert.equal(errors.at(-1), null);
});

test('network failure retries; leaving the scanner cancels requests and ignores their late responses', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  store.getState().setOrders([order(1)], 'Operador');
  let calls = 0, resolveRequest, signal;
  const errors = [];
  const stop = startTrackingRefresh({ getSession: store.getState, applyUpdates: (updates, version) => store.getState().updateTrackingCodes(updates, version), onError: (error) => errors.push(error), fetcher: async (_url, options) => {
    if (++calls === 1) throw new Error('Sem conexão');
    signal = options.signal;
    return new Promise((resolve) => { resolveRequest = resolve; });
  } });
  t.after(stop);
  await flush();
  assert.match(errors[0], /Sem conexão/);
  t.mock.timers.tick(30_000);
  await flush();
  assert.equal(calls, 2);
  stop();
  assert.equal(signal.aborted, true);
  resolveRequest(response([order(1, 'LATE')]));
  await flush();
  assert.equal(store.getState().orders[0].trackingCode, '');
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(calls, 2);
});
