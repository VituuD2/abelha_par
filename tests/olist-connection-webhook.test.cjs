require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const admin = require('../src/lib/supabase/admin.ts');
const auth = require('../src/lib/auth.ts');
const sync = require('../src/lib/olist-sync.ts');
const costs = require('../src/lib/analytics/cost-sync.ts');
const webhook = require('../src/lib/olist-webhook.ts');
const route = require('../src/app/api/webhooks/olist/[ownerId]/[signature]/route.ts');
const settings = require('../src/app/api/ninho/webhook/route.ts');
const { analyticsStatus } = require('../src/lib/analytics/server.ts');

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const CONNECTIONS = [
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];
const UNKNOWN = '55555555-5555-4555-8555-555555555555';
const OTHER_WORKSPACE = '66666666-6666-4666-8666-666666666666';
const secret = () => randomBytes(32).toString('hex');

function fixture(t, role = 'admin') {
  const original = process.env.OLIST_WEBHOOK_SECRET;
  process.env.OLIST_WEBHOOK_SECRET = secret();
  t.after(() => {
    if (original === undefined) delete process.env.OLIST_WEBHOOK_SECRET;
    else process.env.OLIST_WEBHOOK_SECRET = original;
  });
  const rows = CONNECTIONS.map((id, index) => ({
    id, workspace_id: WORKSPACE, name: `Olist ${index + 1}`, enabled: true,
    credential_kind: index === 1 ? 'legacy' : 'oauth',
    legacy_integration_id: index === 1 ? 'legacy-integration' : null,
    webhook_secret: secret(), webhook_last_received_at: null,
  }));
  const state = {
    tables: {
      workspaces: [{ id: WORKSPACE, olist_webhook_enabled: true, olist_webhook_revision: 0 }],
      analytics_connections: rows,
      olist_sync_state: [{ workspace_id: WORKSPACE, last_webhook_at: null }],
      workspace_members: [{ user_id: 'actor', workspace_id: WORKSPACE, role, active: true }],
      analytics_companies: [], analytics_sources: [], tiny_integrations: [],
    },
    reads: [], writes: [], recorded: [], queued: 0, processed: 0, failure: null,
  };
  t.mock.method(auth, 'getAuthenticatedUser', async () => ({ id: 'actor', user_metadata: { role: 'admin' } }));
  t.mock.method(sync, 'enqueueOlistOrders', async () => { state.queued++; });
  t.mock.method(sync, 'processQueuedOlistOrders', async () => { state.processed++; });
  t.mock.method(sync, 'recordWebhook', async id => {
    state.recorded.push(id);
    state.tables.olist_sync_state[0].last_webhook_at = new Date().toISOString();
  });
  t.mock.method(costs, 'costSyncStatus', async () => null);
  t.mock.method(admin, 'createAdminClient', () => ({
    async rpc() { return { data: [], error: null }; },
    from(table) {
      assert.ok(table in state.tables, `unexpected table: ${table}`);
      const predicates = [];
      let fields = '*', values, single = false;
      const query = {
        select(value) { fields = value; state.reads.push({ table, fields: value, predicates }); return query; },
        eq(key, value) { predicates.push(row => row[key] === value); return query; },
        not(key, operator, value) {
          assert.equal(operator, 'is'); assert.equal(value, null);
          predicates.push(row => row[key] != null); return query;
        },
        update(value) { values = value; return query; },
        order() { return query; },
        abortSignal() { return query; },
        single() { single = true; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          const action = values ? 'update' : 'select';
          if (state.failure?.table === table && state.failure.action === action)
            return Promise.resolve({ data: null, error: { message: 'unavailable' } }).then(resolve, reject);
          const matches = state.tables[table].filter(row => predicates.every(predicate => predicate(row)));
          if (values) {
            for (const row of matches) Object.assign(row, values);
            state.writes.push({ table, values, ids: matches.map(row => row.id) });
          }
          const projected = matches.map(row => fields === '*' ? { ...row } : Object.fromEntries(
            fields.split(',').map(key => key.trim()).map(key => [key, row[key]]),
          ));
          return Promise.resolve({ data: single ? projected[0] || null : projected, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  }));
  return state;
}

function post(ownerId, signature) {
  return route.POST(new Request('https://app.test/api/webhooks/olist', {
    method: 'POST', body: JSON.stringify({ dados: { id: 123456 } }),
  }), { params: Promise.resolve({ ownerId, signature }) });
}

test('each connection has its own signed URL and rejects another connection or secret', () => {
  const secrets = CONNECTIONS.map(secret);
  const signatures = CONNECTIONS.map((id, index) => webhook.getOlistConnectionWebhookSignature(id, secrets[index]));
  const urls = CONNECTIONS.map((id, index) => webhook.getOlistConnectionWebhookUrl('https://app.test', id, secrets[index]));
  assert.equal(new Set(signatures).size, 3);
  assert.equal(new Set(urls).size, 3);
  for (let index = 0; index < CONNECTIONS.length; index++) {
    const id = CONNECTIONS[index], value = signatures[index];
    assert.equal(webhook.isValidOlistConnectionWebhookSignature(id, value, secrets[index]), true);
    assert.equal(webhook.isValidOlistConnectionWebhookSignature(CONNECTIONS[(index + 1) % 3], value, secrets[index]), false);
    assert.equal(webhook.isValidOlistConnectionWebhookSignature(id, value, secrets[(index + 1) % 3]), false);
    assert.equal(webhook.isValidOlistConnectionWebhookSignature(id, value.slice(1), secrets[index]), false);
    assert.equal(new URL(urls[index]).pathname, `/api/webhooks/olist/${id}/${value}`);
    assert.ok(!urls[index].includes(secrets[index]));
  }
});

test('connection URLs work without the legacy global signing secret', t => {
  const original = process.env.OLIST_WEBHOOK_SECRET;
  delete process.env.OLIST_WEBHOOK_SECRET;
  t.after(() => {
    if (original !== undefined) process.env.OLIST_WEBHOOK_SECRET = original;
  });
  const value = secret(), id = CONNECTIONS[0];
  const signature = webhook.getOlistConnectionWebhookSignature(id, value);
  assert.equal(webhook.isValidOlistConnectionWebhookSignature(id, signature, value), true);
  assert.ok(webhook.getOlistConnectionWebhookUrl('https://app.test', id, value));
  assert.equal(webhook.getOlistWebhookUrl('https://app.test', WORKSPACE), null);
});

test('connection receipts remain isolated even when order IDs and workspace are shared', async t => {
  const state = fixture(t);
  const rows = state.tables.analytics_connections;
  for (const index of [0, 2]) {
    const row = rows[index];
    const before = Date.now();
    const response = await post(row.id, webhook.getOlistConnectionWebhookSignature(row.id, row.webhook_secret));
    assert.equal(response.status, 200);
    assert.ok(Date.parse(row.webhook_last_received_at) >= before);
    assert.ok(Date.parse(row.webhook_last_received_at) <= Date.now());
  }
  assert.equal(rows[1].webhook_last_received_at, null);
  assert.deepEqual(state.writes.map(write => write.ids), [[rows[0].id], [rows[2].id]]);
  assert.deepEqual(state.recorded, []);
  assert.equal(state.tables.olist_sync_state[0].last_webhook_at, null);
  assert.equal(state.queued, 0);
  assert.equal(state.processed, 0);
});

test('malformed, unknown, disabled and cross-connection webhooks fail closed without writes', async t => {
  const state = fixture(t);
  const [first, second] = state.tables.analytics_connections;
  const valid = webhook.getOlistConnectionWebhookSignature(first.id, first.webhook_secret);
  for (const [id, value] of [
    ['not-a-uuid', valid], [UNKNOWN, valid], [first.id, 'invalid'],
    [first.id, ''], [second.id, valid],
  ]) assert.equal((await post(id, value)).status, 404);
  first.enabled = false;
  assert.equal((await post(first.id, valid)).status, 404);
  first.enabled = true;
  state.tables.workspaces[0].olist_webhook_enabled = false;
  assert.equal((await post(first.id, valid)).status, 404);
  assert.deepEqual(state.writes, []);
  assert.deepEqual(state.recorded, []);
  assert.equal(state.queued, 0);
  assert.equal(state.processed, 0);
});

test('legacy workspace URLs still work and rotating the legacy revision invalidates the old signature', async t => {
  const state = fixture(t);
  const original = webhook.getOlistWebhookSignature(WORKSPACE, 0);
  assert.equal((await post(WORKSPACE, original)).status, 200);
  assert.deepEqual(state.recorded, [WORKSPACE]);
  const rows = state.tables.analytics_connections;
  assert.ok(rows[1].webhook_last_received_at);
  assert.equal(rows[0].webhook_last_received_at, null);
  assert.equal(rows[2].webhook_last_received_at, null);
  state.tables.workspaces[0].olist_webhook_revision = 1;
  assert.equal((await post(WORKSPACE, original)).status, 404);
  assert.equal(state.recorded.length, 1);
  const rotated = webhook.getOlistWebhookSignature(WORKSPACE, 1);
  assert.equal((await post(WORKSPACE, rotated)).status, 200);
  assert.equal(state.recorded.length, 2);
  assert.equal(state.queued, 0);
  assert.equal(state.processed, 0);
});

test('connection lookup and timestamp failures return retryable errors without syncing', async t => {
  const state = fixture(t);
  const row = state.tables.analytics_connections[0];
  const signature = webhook.getOlistConnectionWebhookSignature(row.id, row.webhook_secret);
  state.failure = { table: 'analytics_connections', action: 'select' };
  assert.equal((await post(row.id, signature)).status, 503);
  state.failure = { table: 'analytics_connections', action: 'update' };
  assert.equal((await post(row.id, signature)).status, 500);
  assert.equal(row.webhook_last_received_at, null);
  assert.deepEqual(state.recorded, []);
  assert.equal(state.queued, 0);
  assert.equal(state.processed, 0);
});

test('admin webhook settings return three scoped URLs and receipt times without raw secrets', async t => {
  const state = fixture(t);
  const rows = state.tables.analytics_connections;
  rows[0].webhook_last_received_at = '2026-10-22T15:30:00.000Z';
  rows.push({ ...rows[0], id: UNKNOWN, workspace_id: OTHER_WORKSPACE, webhook_secret: secret() });
  const response = await settings.GET(new Request('https://app.test/api/ninho/webhook'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const body = await response.json();
  assert.equal(body.connections.length, 3);
  assert.equal(new Set(body.connections.map(connection => connection.url)).size, 3);
  for (const connection of body.connections) {
    const row = rows.find(row => row.id === connection.id);
    assert.equal(row.workspace_id, WORKSPACE);
    assert.equal(connection.name, row.name);
    assert.equal(connection.lastReceivedAt, row.webhook_last_received_at);
    assert.deepEqual(Object.keys(connection).sort(), ['id', 'lastReceivedAt', 'name', 'url']);
    assert.equal(new URL(connection.url).pathname, `/api/webhooks/olist/${row.id}/${webhook.getOlistConnectionWebhookSignature(row.id, row.webhook_secret)}`);
  }
  for (const row of rows) assert.ok(!JSON.stringify(body).includes(row.webhook_secret));
});

test('operators cannot read connection webhook URLs even with forged admin metadata', async t => {
  const state = fixture(t, 'operator');
  const response = await settings.GET(new Request('https://app.test/api/ninho/webhook'));
  assert.equal(response.status, 403);
  assert.ok(state.reads.every(read => read.table === 'workspace_members'));
  const text = await response.text();
  assert.ok(!text.includes('/api/webhooks/olist/'));
  for (const row of state.tables.analytics_connections) assert.ok(!text.includes(row.webhook_secret));
});

test('shared analytics status never selects or returns connection webhook secrets', async t => {
  const state = fixture(t);
  const result = await analyticsStatus(WORKSPACE, 'actor');
  const reads = state.reads.filter(read => read.table === 'analytics_connections');
  assert.ok(reads.length);
  assert.ok(reads.every(read => !read.fields.split(',').map(field => field.trim()).includes('webhook_secret')));
  for (const row of state.tables.analytics_connections) assert.ok(!JSON.stringify(result).includes(row.webhook_secret));
});
