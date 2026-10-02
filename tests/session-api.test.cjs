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
  t.mock.method(sessions, 'submitSessionScan', async () => { throw new Error('must not write'); });
  assert.equal((await createRoute.POST(request(body))).status, 401);
  assert.equal((await scanRoute.POST(request({ code: 'CODE' }), { params: Promise.resolve({ id }) })).status, 401);
});
test('scan uses one atomic RPC with server identity and exposes timings; a foreign session returns 404', async t => {
  t.mock.method(auth, 'authorize', async () => ({ access: { user: {id:owner}, workspaceId:workspace, role:'operator' } }));
  const session = { id, responsible: 'Operador', status: 'active', revision: 0, orders: [{ id: 1, trackingCode: 'CODE', status: 'pending', clientName: 'Teste' }] };
  t.mock.method(sessions, 'readScanSession', async requestedOwner => { assert.equal(requestedOwner, workspace); return session; });
  let calls = 0;
  t.mock.method(admin, 'createAdminClient', () => ({ rpc: async (name, params) => {
    calls++;
    assert.equal(name, 'submit_workspace_scan');
    assert.deepEqual(params, { p_workspace: workspace, p_actor: owner, p_session: id, p_code: 'CODE', p_revision: 0 });
    return { data: { confirmation: { sessionId: id, revision: 1, scannedCount: 1, totalCount: 1 }, result: { type: 'success', order: { ...session.orders[0], status: 'checked' } } }, error: null };
  } }));
  const response = await scanRoute.POST(request({ code: 'CODE', revision: 0, actorId: 'forged' }), { params: Promise.resolve({ id }) });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.result.order.status, 'checked');
  assert.equal(payload.confirmation.revision, 1);
  assert.equal(payload.session, undefined);
  assert.equal(calls, 1);
  assert.match(response.headers.get('Server-Timing'), /authorize;dur=.*save;dur=.*atomic/);
  t.mock.method(sessions, 'readScanSession', async () => null);
  assert.equal((await scanRoute.GET(request({}), { params: Promise.resolve({ id }) })).status, 404);
});

test('invalid scans never call the database and atomic errors retain their HTTP status', async t => {
  t.mock.method(auth, 'authorize', async () => ({ access: { user: {id:owner}, workspaceId:workspace } }));
  t.mock.method(admin, 'createAdminClient', () => { throw new Error('must not reach database'); });
  for (const body of [null, {}, { code: '' }, { code: ' '.repeat(10) }, { code: 'A'.repeat(201) }]) {
    assert.equal((await scanRoute.POST(request(body), { params: Promise.resolve({ id }) })).status, 400);
  }
  for (const [message, status] of [['SESSION_NOT_FOUND',404], ['SESSION_CLOSED',409], ['MEMBER_REQUIRED',403]]) {
    t.mock.method(admin, 'createAdminClient', () => ({ rpc: async () => ({ data: null, error: { code: 'P0001', message } }) }));
    assert.equal((await scanRoute.POST(request({ code: 'CODE' }), { params: Promise.resolve({ id }) })).status, status);
  }
});

test('missing migration falls back with revision retry; uncertain writes never trigger fallback', async t => {
  const session = { id, status: 'active', revision: 0, orders: [{ id: 1, trackingCode: 'CODE', status: 'pending', clientName: 'Teste' }] };
  let writes = 0, reads = 0;
  t.mock.method(admin, 'createAdminClient', () => ({
    rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'missing function' } }),
    from: table => {
      assert.equal(table, 'scan_sessions');
      let update;
      const filters = [];
      const chain = { select: () => chain, eq: (key, value) => { filters.push([key,value]); return chain; }, update: value => { update = value; return chain; },
        maybeSingle: async () => {
          assert.ok(filters.some(([key,value]) => key === 'workspace_id' && value === workspace));
          if (!update) { reads++; return { data: { ...session }, error: null }; }
          if (++writes === 1) { session.revision++; return { data: null, error: null }; }
          assert.ok(filters.some(([key,value]) => key === 'revision' && value === 1));
          return { data: { ...session, ...update }, error: null };
        } };
      return chain;
    },
  }));
  const saved = await sessions.submitSessionScan(workspace, id, owner, 'CODE', 0);
  assert.equal(saved.mode, 'legacy'); assert.equal(reads, 2); assert.equal(writes, 2);
  assert.equal(saved.payload.session.revision, 2); assert.equal(saved.payload.session.orders[0].status, 'checked');
  t.mock.method(admin, 'createAdminClient', () => ({
    rpc: async () => ({ data: null, error: { code: '08006', message: 'connection lost' } }),
    from: () => { throw new Error('unsafe fallback'); },
  }));
  await assert.rejects(sessions.submitSessionScan(workspace, id, owner, 'CODE', 0), /gravar a conferência/);
});
