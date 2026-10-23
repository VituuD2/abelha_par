require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { isolatedDatabase, ws, connections } = require('../scripts/analytics-isolated.cjs');
const admin = require('../src/lib/supabase/admin.ts');
const auth = require('../src/lib/analytics/auth.ts');
const provider = require('../src/lib/analytics/olist-client.ts');
const { processAnalyticsWebhookBatches } = require('../src/lib/analytics/sync.ts');
const webhook = require('../src/lib/olist-webhook.ts');
const route = require('../src/app/api/webhooks/olist/[ownerId]/[signature]/route.ts');

// Run the real route, worker and ingest against PostgreSQL; only the ERP is simulated.
function supabase(db) {
  const clean = value => JSON.parse(JSON.stringify(value));
  const parameter = value => value && typeof value === 'object' ? JSON.stringify(value) : value;
  return {
    async rpc(name, args) {
      const entries = Object.entries(args);
      const call = `${name}(${entries.map(([key], i) => `${key}=>$${i + 1}`).join(',')})`;
      try {
        const set = ['analytics_claim_webhook_jobs'].includes(name);
        const { rows } = await db.query(set ? `SELECT * FROM ${call}` : `SELECT ${call} result`, entries.map(([, v]) => parameter(v)));
        return { data: clean(set ? rows : rows[0].result), error: null };
      } catch (error) { return { data: null, error }; }
    },
    from(table) {
      let operation = 'select', fields = '*', patch, conflict, single = false, limit, order;
      const predicates = [];
      const chain = {
        select(value = '*') { fields = value; return chain; },
        eq(key, value) { predicates.push([key, '=', value]); return chain; },
        gt(key, value) { predicates.push([key, '>', value]); return chain; },
        lte(key, value) { predicates.push([key, '<=', value]); return chain; },
        order(key) { order = key; return chain; },
        limit(value) { limit = value; return chain; },
        maybeSingle() { single = true; return chain; },
        single() { single = true; return chain; },
        update(value) { operation = 'update'; patch = value; return chain; },
        upsert(value, options) { operation = 'upsert'; patch = value; conflict = options.onConflict; return chain; },
        delete() { operation = 'delete'; return chain; },
        async then(resolve, reject) {
          const values = [], bind = v => { values.push(parameter(v)); return `$${values.length}`; };
          let sql;
          if (operation === 'upsert') {
            const entries = Object.entries(patch);
            sql = `INSERT INTO ${table}(${entries.map(([k]) => k)}) VALUES(${entries.map(([, v]) => bind(v))})
              ON CONFLICT(${conflict}) DO UPDATE SET ${entries.map(([k]) => `${k}=excluded.${k}`)} RETURNING ${fields}`;
          } else {
            sql = operation === 'select' ? `SELECT ${fields} FROM ${table}` : operation === 'delete'
              ? `DELETE FROM ${table}` : `UPDATE ${table} SET ${Object.entries(patch).map(([k, v]) => `${k}=${bind(v)}`)}`;
            if (predicates.length) sql += ' WHERE ' + predicates.map(([k, op, v]) => `${k}${op}${bind(v)}`).join(' AND ');
            if (operation === 'select') {
              if (order) sql += ` ORDER BY ${order}`;
              if (limit) sql += ` LIMIT ${limit}`;
            } else sql += ` RETURNING ${fields}`;
          }
          try {
            const { rows } = await db.query(sql, values);
            return resolve({ data: clean(single ? rows[0] || null : rows), error: null });
          } catch (error) { return Promise.resolve({ data: null, error }).then(resolve, reject); }
        },
      };
      return chain;
    },
  };
}

test('duplicate and out-of-order Olist events create one sale, preserve racing events and back off on 429 without moving the sweep', async t => {
  const db = await isolatedDatabase();
  t.after(() => db.close());
  for (const file of ['migration_v14_v15_analytics_complete.sql', 'migration_v16_analytics_confirmed_unlinked.sql',
    'migration_v18_analytics_olist_costs.sql', 'migration_v19_analytics_cost_effective_dates.sql',
    'migration_v23_olist_api_usage.sql', 'migration_v24_analytics_resumable_import.sql',
    'migrations/20261023024000_olist_connection_webhooks.sql', 'migrations/20261023030000_analytics_webhook_orders.sql'])
    await db.exec(readFileSync('supabase/' + file, 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261023030000_analytics_webhook_orders.sql', 'utf8'));
  const rows = async (sql, args = []) => (await db.query(sql, args)).rows;
  const connection = connections[0];
  const [account] = await rows('SELECT webhook_secret FROM analytics_connections WHERE id=$1', [connection]);
  const signature = webhook.getOlistConnectionWebhookSignature(connection, account.webhook_secret);
  const post = (tipo, dados = { id: 91 }, body) => route.POST(new Request('https://app.test/webhook', {
    method: 'POST', body: body ?? JSON.stringify({ tipo, dados }),
  }), { params: Promise.resolve({ ownerId: connection, signature }) });
  const [job] = await rows(`INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,
    page_offset,pending_ids,pending_index,processed,attempts,import_state) VALUES($1,$2,'backfill','2026-09-01','2026-09-30',
    '2026-09-10',300,'["88","89"]',1,25,2,'{"order":{"externalId":"89"}}') RETURNING *`, [ws, connection]);
  t.mock.method(admin, 'createAdminClient', () => supabase(db));
  t.mock.method(auth, 'analyticsToken', async () => 'test-token');
  t.mock.method(auth, 'ensureAnalyticsIdentity', async () => {});
  const paths = [];
  let status = 1, rateLimited = false, racing = false;
  t.mock.method(provider, 'olistRequest', async (_token, conn, path, options) => {
    assert.equal(conn, connection);
    assert.ok(options.deadlineMs <= Date.now() + 20000);
    paths.push(path);
    if (path === '/pedidos/91') {
      if (rateLimited) throw new provider.AnalyticsApiError(429, 120);
      if (racing) { racing = false; assert.equal((await post('atualizacao_pedido')).status, 200); }
      return { id: 91, data: '2026-09-10', situacao: status, valorTotalPedido: '20', marcadores: [],
        ecommerce: { id: 1, nome: 'Site' }, cliente: { id: 1, nome: 'Cliente' },
        itens: [{ produto: { id: 0, descricao: 'Item avulso' }, quantidade: 2, valorUnitario: 10 }] };
    }
    throw Error(`Unexpected ERP call: ${path}`);
  });
  assert.equal((await post('atualizacao_pedido')).status, 200);
  assert.equal((await post('inclusao_pedido')).status, 200);
  assert.equal((await post('atualizacao_pedido', { id: '91', codigoSituacao: 'aberto' })).status, 200);
  assert.deepEqual(paths, [], 'receipt must never contact Olist');
  assert.equal((await rows('SELECT * FROM analytics_webhook_orders')).length, 1);
  assert.equal((await processAnalyticsWebhookBatches(ws)).processed, 1);
  assert.equal((await rows('SELECT * FROM analytics_orders')).length, 1);
  assert.equal((await rows('SELECT quantity FROM analytics_items'))[0].quantity, '2.000000');

  // An older notification arrives after ingestion; the current ERP detail wins.
  assert.equal((await post('inclusao_pedido', { id: 91, codigoSituacao: 'cancelado' })).status, 200);
  racing = true;
  assert.equal((await processAnalyticsWebhookBatches(ws)).processed, 1);
  assert.equal((await rows('SELECT * FROM analytics_webhook_orders')).length, 1, 'event arriving during fetch survives acknowledgement');
  assert.equal((await processAnalyticsWebhookBatches(ws)).processed, 1);
  assert.equal((await rows('SELECT * FROM analytics_webhook_orders')).length, 0);
  assert.equal((await rows('SELECT * FROM analytics_orders')).length, 1);
  assert.equal((await rows('SELECT quantity FROM analytics_items'))[0].quantity, '2.000000');

  await post('atualizacao_pedido');
  rateLimited = true;
  assert.ok((await processAnalyticsWebhookBatches(ws)).error);
  const [deferred] = await rows('SELECT next_at,attempts FROM analytics_webhook_orders');
  assert.ok(deferred.next_at.getTime() > Date.now() + 110000);
  assert.equal(deferred.attempts, 1);
  await post('inclusao_pedido');
  assert.equal(+(await rows('SELECT next_at FROM analytics_webhook_orders'))[0].next_at, +deferred.next_at);
  assert.equal((await processAnalyticsWebhookBatches(ws)).processed, 0);
  rateLimited = false;
  status = 2;
  await db.exec('UPDATE analytics_webhook_orders SET next_at=now()');
  assert.equal((await processAnalyticsWebhookBatches(ws)).processed, 1);
  assert.equal((await rows('SELECT status FROM analytics_orders'))[0].status, 2);
  assert.equal((await rows('SELECT * FROM analytics_orders')).length, 1);
  assert.ok(paths.every(path => path === '/pedidos/91'));

  const [after] = await rows('SELECT * FROM analytics_sync_jobs WHERE id=$1', [job.id]);
  for (const key of ['cursor_date', 'page_offset', 'pending_ids', 'pending_index', 'processed', 'attempts', 'import_state', 'next_at'])
    assert.deepEqual(after[key], job[key], `sweep ${key} must be preserved`);
  assert.equal(after.status, 'queued');
  assert.equal(after.lease_token, null);
  assert.equal((await rows('SELECT incremental_through FROM analytics_connections WHERE id=$1', [connection]))[0].incremental_through, null);
  assert.equal((await post('inclusao_pedido', { id: true })).status, 400);
  assert.equal((await post('inclusao_pedido', {}, '{broken')).status, 400);

  await db.query('SELECT analytics_enqueue_webhook_order($1,$2,$3)', [ws, connections[1], '91']);
  await post('atualizacao_pedido');
  assert.equal((await rows('SELECT * FROM analytics_webhook_orders')).length, 2, 'same ID in different accounts is independent');
  assert.equal((await rows("SELECT relrowsecurity FROM pg_class WHERE oid='analytics_webhook_orders'::regclass"))[0].relrowsecurity, true);
  assert.equal((await rows("SELECT * FROM pg_policies WHERE tablename='analytics_webhook_orders'")).length, 0);
  await db.exec('SET ROLE authenticated');
  await assert.rejects(db.query('SELECT * FROM analytics_webhook_orders'), /permission denied/);
  await assert.rejects(db.query('SELECT analytics_claim_webhook_jobs()'), /permission denied/);
  await db.exec('RESET ROLE');
  const claimed = await rows('SELECT * FROM analytics_claim_webhook_jobs($1,3)', [ws]);
  assert.equal(claimed.length, 2);
  assert.equal(new Set(claimed.map(item => item.connection_id)).size, 2);
  assert.ok(claimed.some(item => item.connection_id === connections[1]), 'an account without prior imports can drain its queue');
  assert.equal((await rows('SELECT * FROM analytics_claim_webhook_jobs($1,3)', [ws])).length, 0, 'live account leases cannot be reclaimed');
  assert.equal((await rows('SELECT * FROM analytics_claim_job($1)', [ws])).length, 0, 'sweep and webhook share account exclusion');
  await db.exec("UPDATE analytics_connections SET sync_locked_until=now()-interval '1 second'; UPDATE analytics_sync_jobs SET lease_until=now()-interval '1 second'");
  const reclaimed = await rows('SELECT * FROM analytics_claim_webhook_jobs($1,3)', [ws]);
  assert.equal(reclaimed.length, 2);
  assert.ok(reclaimed.every(item => claimed.find(old => old.id === item.id).lease_token !== item.lease_token));
});
