require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const auth = require('../src/lib/access.ts');
const admin = require('../src/lib/supabase/admin.ts');
const nuvemshop = require('../src/lib/nuvemshop.ts');
const sessions = require('../src/lib/scan-session-server.ts');
const createRoute = require('../src/app/api/scan-sessions/route.ts');
const scanRoute = require('../src/app/api/scan-sessions/[id]/route.ts');
const owner = '10000000-0000-4000-8000-000000000001';
const workspace = '10000000-0000-4000-8000-000000000005';
const id = '20000000-0000-4000-8000-000000000001';
const mapping = { ecommerceId: 23257, referenceKind: 'number', referenceField: 'ecommerceOrderNumber' };
const shopOrder = { id: 2083401789, number: '116', storeId: '8255405', status: 'open', paymentStatus: 'paid', clientName: 'Servidor' };
const cachedOrder = { olist_order_id: 393310669, numero_pedido: 10101, ecommerce_id: 23257, ecommerce_order_number: '116', tracking_code: 'SERVER-CODE', client_name: 'Servidor', situacao: 1, resolved_at: new Date().toISOString() };
const request = body => new Request('http://localhost/api/scan-sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const body = { id, responsible: 'Operador', nuvemshopIds: [2083401789], olistIds: [393310669] };

function fixture(t, { duplicates = false, stale = false } = {}) {
  let saved;
  t.mock.method(auth, 'authorize', async () => ({ access: { user: {id:owner}, workspaceId:workspace, role:'operator' } }));
  t.mock.method(sessions, 'readScanSession', async requestedOwner => { assert.equal(requestedOwner, workspace); return null; });
  t.mock.method(nuvemshop, 'getNuvemshopConnection', async () => ({ storeId: '8255405', mapping }));
  t.mock.method(admin, 'createAdminClient', () => ({ from(table) {
    const filters = [];
    const chain = {
      select() { return chain; }, eq(key, value) { filters.push([key, value]); return chain; }, in() { return chain; }, limit() { return chain; },
      insert(value) { saved = value; return chain; }, single() { return Promise.resolve({ data: saved, error: null }); },
      then(resolve, reject) {
        assert.ok(filters.some(([key, value]) => key === 'workspace_id' && value === workspace));
        if (table === 'nuvemshop_order_cache') {
          assert.ok(filters.some(([key, value]) => key === 'store_id' && value === '8255405'));
          return Promise.resolve({ data: [{ payload: shopOrder, fetched_at: stale ? '2020-01-01' : new Date().toISOString() }], error: null }).then(resolve, reject);
        }
        assert.ok(filters.some(([key, value]) => key === 'ecommerce_id' && value === 23257));
        const data = duplicates ? [cachedOrder, { ...cachedOrder, olist_order_id: 999 }] : [cachedOrder];
        return Promise.resolve({ data, count: data.length, error: null }).then(resolve, reject);
      },
    };
    return chain;
  } }));
  return () => saved;
}

test('creation ignores forged client snapshot and uses only workspace-scoped server records while retaining the creator', async t => {
  const saved = fixture(t);
  const response = await createRoute.POST(request({ ...body, orders: [{ trackingCode: 'FORGED', status: 'checked' }] }));
  assert.equal(response.status, 201);
  assert.equal(saved().orders[0].trackingCode, 'SERVER-CODE');
  assert.equal(saved().orders[0].status, 'pending');
  assert.equal(saved().workspace_id, workspace);
  assert.equal(saved().owner_id, owner);
  assert.equal(saved().orders[0].nuvemshopNumber, '116');
});
test('creation rejects an omitted duplicate candidate and expired selection', async t => {
  await t.test('duplicate omitted by browser', async st => {
    const saved = fixture(st, { duplicates: true });
    assert.equal((await createRoute.POST(request(body))).status, 409);
    assert.equal(saved(), undefined);
  });
  await t.test('expired server snapshot', async st => {
    const saved = fixture(st, { stale: true });
    assert.equal((await createRoute.POST(request(body))).status, 409);
    assert.equal(saved(), undefined);
  });
});
test('unauthenticated creation and scans are rejected without reading or writing orders', async t => {
  t.mock.method(auth, 'authorize', async () => ({response: Response.json({error:'Unauthorized'},{status:401})}));
  t.mock.method(sessions, 'readScanSession', async () => { throw new Error('must not read'); });
  assert.equal((await createRoute.POST(request(body))).status, 401);
  assert.equal((await scanRoute.POST(request({ code: 'CODE' }), { params: Promise.resolve({ id }) })).status, 401);
});
test('scan retries a concurrent revision safely; a foreign session returns 404', async t => {
  t.mock.method(auth, 'authorize', async () => ({ access: { user: {id:owner}, workspaceId:workspace, role:'operator' } }));
  const session = { id, responsible: 'Operador', status: 'active', revision: 0, orders: [{ id: 1, trackingCode: 'CODE', status: 'pending', clientName: 'Teste' }] };
  t.mock.method(sessions, 'readScanSession', async requestedOwner => { assert.equal(requestedOwner, workspace); return session; });
  let writes = 0;
  t.mock.method(sessions, 'updateSessionOrders', async (requestedOwner, previous, orders) => {
    assert.equal(requestedOwner, workspace);
    if (++writes === 1) { session.revision++; return null; }
    return { ...previous, orders, revision: previous.revision + 1 };
  });
  const response = await scanRoute.POST(request({ code: 'CODE' }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.session.orders[0].status, 'checked');
  assert.equal(payload.session.revision, 2);
  t.mock.method(sessions, 'readScanSession', async () => null);
  assert.equal((await scanRoute.GET(request({}), { params: Promise.resolve({ id }) })).status, 404);
});
