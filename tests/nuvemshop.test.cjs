require('./setup.cjs');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { reconcileOrders } = require('../src/lib/reconciliation.ts');
const { toggleOrderSelection, searchText } = require('../src/lib/order-selection.ts');
const { applyScan } = require('../src/lib/scan-session.ts');
const { normalizeNuvemshopOrder, nuvemshopRequest } = require('../src/lib/nuvemshop.ts');
const { fetchOlistOrdersPage, normalizeOlistOrder } = require('../src/lib/olist.ts');
const { extractOlistOrderId } = require('../src/lib/olist-webhook.ts');
const { usePreparationStore: preparation } = require('../src/stores/preparation-store.ts');
const { useScanStore: scanner } = require('../src/stores/scan-store.ts');
const { isValidDateRange, saoPauloDate } = require('../src/lib/dates.ts');
const mapping = { ecommerceId: 23257, referenceField: 'ecommerceOrderNumber', referenceKind: 'number' };
const nuvem = (id = 2083401789, number = '116', extra = {}) => ({ id, number, storeId: '8255405', clientName: 'Cliente teste', status: 'open', paymentStatus: 'paid', shippingStatus: 'unpacked', ...extra });
const olist = (id = 393310669, reference = '116', extra = {}) => ({ id, numeroPedido: 10101, ecommerceId: 23257, ecommerceOrderNumber: reference, yampiId: '999', trackingCode: '', clientName: 'Cliente teste', situacao: 1, dataCriacao: '2026-09-29', ...extra });
afterEach(() => { preparation.getState().reset(); scanner.getState().reset(); });

test('validated mapping uses store order number and integration, independent of names and ERP number', () => {
  const result = reconcileOrders([nuvem()], [olist(), olist(2, '116', { ecommerceId: 999 }), olist(3, '117')], mapping);
  assert.equal(result.issues.length, 0);
  assert.equal(result.ignored, 2);
  assert.equal(result.orders[0].nuvemshopId, 2083401789);
  assert.equal(result.orders[0].nuvemshopNumber, '116');
  assert.equal(result.orders[0].yampiId, null);
  assert.equal(result.orders[0].trackingCode, '');
  assert.equal(reconcileOrders([nuvem()], [olist(2, '2083401789')], mapping).orders.length, 0);
});
test('missing, unpaid, cancelled, cross-store, repeated and ambiguous orders block reconciliation', () => {
  const cases = [
    [[nuvem()], []], [[nuvem(1, '116', { paymentStatus: 'pending' })], [olist()]],
    [[nuvem(1, '116', { status: 'cancelled' })], [olist()]], [[nuvem()], [olist(1, '116', { situacao: 2 })]],
    [[nuvem(), nuvem()], [olist()]], [[nuvem(), nuvem(2, '117', { storeId: 'other' })], [olist()]],
    [[nuvem()], [olist(), olist(2)]], [[nuvem()], [olist(1, '116', { situacao: null })]],
  ];
  for (const [selected, erp] of cases) assert.ok(reconcileOrders(selected, erp, mapping).issues.length);
});
test('duplicate normalized tracking is blocked both before and during scanning', () => {
  const result = reconcileOrders([nuvem(1), nuvem(2, '117')], [olist(1, '116', { trackingCode: 'abcdefghijkl12345678' }), olist(2, '117', { trackingCode: '12345678' })], mapping);
  assert.equal(result.issues.length, 2);
  assert.equal(applyScan(result.orders, '12345678').result.type, 'error');
  const single = applyScan([result.orders[0]], '12345678');
  assert.equal(single.result.type, 'success');
  assert.equal(applyScan(single.orders, '12345678').result.type, 'error');
});
test('Shift selection follows visible sort order; hidden selections survive and hidden anchor is ignored', () => {
  assert.deepEqual(toggleOrderSelection([99, 4], [4, 3, 2, 1], 2, 4, true), [99, 4, 3, 2]);
  assert.deepEqual(toggleOrderSelection([99, 4, 3, 2], [4, 3, 2, 1], 2, 4, true), [99]);
  assert.deepEqual(toggleOrderSelection([99], [3, 1], 1, 4, true), [99, 1]);
  assert.equal(searchText('  MÁRCIA  '), 'marcia');
});
test('selection works in either fetch order, persists through navigation, invalidates on edits, isolates accounts', async () => {
  preparation.getState().bindOwner('owner-a');
  preparation.getState().setOlistOrders([olist()]);
  preparation.getState().setNuvemshopOrders([nuvem()]);
  preparation.getState().setSelectedIds([2083401789]);
  preparation.getState().confirmSelection();
  await preparation.persist.rehydrate();
  assert.deepEqual(preparation.getState().confirmedIds, [2083401789]);
  assert.equal(preparation.getState().olistOrders.length, 1);
  preparation.getState().setSelectedIds([]);
  assert.equal(preparation.getState().confirmedAt, null);
  preparation.getState().bindOwner('owner-b');
  assert.equal(preparation.getState().olistOrders.length, 0);
  assert.equal(preparation.getState().nuvemshopOrders.length, 0);
});
test('Nuvemshop adapter separates IDs and uses documented auth, pagination and rate limit headers', async t => {
  const value = normalizeNuvemshopOrder({ id: 2083401789, number: 116, store_id: 8255405, billing_name: 'Cliente', payment_status: 'paid' }, '8255405');
  assert.equal(value.number, '116');
  assert.throws(() => normalizeNuvemshopOrder({ id: 1, number: 116, store_id: 999 }, '8255405'));
  t.mock.method(global, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.nuvemshop.com.br/2025-03/8255405/orders?page=2');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.match(options.headers['User-Agent'], /Abelha Par/);
    return new Response('{}', { status: 429, headers: { 'x-rate-limit-reset': '2500' } });
  });
  await assert.rejects(nuvemshopRequest('8255405', 'test-token', '/orders?page=2'), error => error.status === 429 && error.retryAfterSeconds === 3);
});
test('Olist pagination does not stop on a page without Nuvemshop orders and advances dates', async t => {
  const urls = [];
  t.mock.method(global, 'fetch', async url => {
    urls.push(new URL(url));
    return new Response(JSON.stringify({ itens: [{ id: 1, ecommerce: { id: 999 } }], paginacao: { total: urls.length === 1 ? 101 : 100 } }));
  });
  const params = { token: 'test', dateFrom: '2026-09-29', dateTo: '2026-09-30', dateMode: 'updated', ecommerceId: 23257 };
  const first = await fetchOlistOrdersPage(params);
  assert.deepEqual(first.orders, []);
  assert.deepEqual(first.nextCursor, { day: 0, offset: 100 });
  const second = await fetchOlistOrdersPage({ ...params, cursor: first.nextCursor });
  assert.deepEqual(second.nextCursor, { day: 1, offset: 0 });
  const third = await fetchOlistOrdersPage({ ...params, cursor: second.nextCursor });
  assert.equal(third.nextCursor, null);
  assert.equal(urls[2].searchParams.get('dataAtualizacao'), '2026-09-30');
  const normalized = normalizeOlistOrder({ id: 1, numeroPedido: 10101, ecommerce: { id: 23257, numeroPedidoEcommerce: '#116' } });
  assert.equal(normalized.ecommerceOrderNumber, '116');
  assert.equal(normalized.yampiId, null);
});
test('server scan failure never marks an order; a successful retry restores authoritative state', async t => {
  const orders = [{ ...olist(), status: 'pending', trackingCode: 'CODE1' }];
  const session = { id: 'session-a', orders, responsible: 'Operador', revision: 0, status: 'active', batch_id: null };
  scanner.getState().setSession(session);
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    if (++calls === 1) throw new Error('offline');
    const scan = applyScan(orders, 'CODE1');
    return new Response(JSON.stringify({ session: { ...session, orders: scan.orders, revision: 1 }, result: scan.result }));
  });
  await scanner.getState().submitBarcode('CODE1');
  assert.equal(scanner.getState().scannedCount, 0);
  scanner.getState().acknowledgeError();
  await scanner.getState().submitBarcode('CODE1');
  assert.equal(scanner.getState().state, 'complete');
  assert.equal(scanner.getState().scannedCount, 1);
  const persisted = JSON.parse(localStorage.getItem('abelha-scan-session-v1')).state;
  assert.deepEqual(Object.keys(persisted).sort(), ['ownerId', 'sessionId']);
});
test('date boundaries use São Paulo and reject impossible dates; official webhook uses dados.id', () => {
  assert.equal(saoPauloDate(new Date('2026-09-30T01:00:00Z')), '2026-09-29');
  assert.equal(isValidDateRange('2026-02-30', '2026-03-02'), false);
  assert.equal(isValidDateRange('2026-01-01', '2026-02-01'), false);
  assert.equal(extractOlistOrderId({ dados: { id: '393310669' }, id: 'unrelated' }), 393310669);
});
