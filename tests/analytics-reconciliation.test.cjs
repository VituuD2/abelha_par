require('./setup.cjs');
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { isolatedDatabase, ws, connections } = require('../scripts/analytics-isolated.cjs');
const admin = require('../src/lib/supabase/admin.ts');
const auth = require('../src/lib/analytics/auth.ts');
const provider = require('../src/lib/analytics/olist-client.ts');
const { processAnalyticsReconciliation } = require('../src/lib/analytics/sync.ts');
const { dayAfter } = require('../src/lib/analytics/import-plan.ts');
const migration = readFileSync('supabase/migrations/20261023040000_analytics_sales_reconciliation.sql', 'utf8');
const connection = connections[0];
let db, today;
const rows = async (sql, args = []) => (await db.query(sql, args)).rows;

// Only the Supabase transport and ERP are simulated; claims, totals and repairs use real PostgreSQL.
function setup(t, request) {
  t.mock.method(Date, 'now', () => Date.parse(today + 'T05:05:00Z'));
  t.mock.method(auth, 'analyticsToken', async (workspace, account) => {
    assert.equal(workspace, ws); assert.equal(account, connection); return 'test-token';
  });
  t.mock.method(admin, 'createAdminClient', () => ({
    async rpc(name, args) {
      const entries = Object.entries(args);
      const call = `${name}(${entries.map(([key], index) => `${key}=>$${index + 1}`).join(',')})`;
      const set = name === 'analytics_claim_reconciliation';
      const result = await rows(set ? `SELECT * FROM ${call}` : `SELECT ${call} result`, entries.map(([, value]) => value));
      return { data: JSON.parse(JSON.stringify(set
        ? result.map(row => ({ ...row, sale_day: row.sale_day.toISOString().slice(0, 10) }))
        : result[0].result)), error: null };
    },
    from(table) {
      assert.equal(table, 'analytics_connections');
      let patch;
      const filters = [];
      const query = {
        update(value) { patch = value; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        async then(resolve, reject) {
          try {
            const entries = Object.entries(patch), values = [...entries, ...filters].map(([, value]) => value);
            await db.query(`UPDATE ${table} SET ${entries.map(([key], index) => `${key}=$${index + 1}`)}
              WHERE ${filters.map(([key], index) => `${key}=$${entries.length + index + 1}`).join(' AND ')}`, values);
            return resolve({ error: null });
          } catch (error) { return Promise.resolve({ error }).then(resolve, reject); }
        },
      };
      return query;
    },
  }));
  const paths = [];
  t.mock.method(provider, 'olistRequest', async (_token, account, path, options) => {
    assert.equal(account, connection);
    assert.equal(options.retryTransient, false);
    assert.ok(options.deadlineMs <= Date.now() + 40000);
    const params = new URL('https://test' + path).searchParams;
    assert.equal(params.get('dataInicial'), params.get('dataFinal'));
    paths.push(params);
    return request(params, paths.length);
  });
  return paths;
}

before(async () => {
  db = await isolatedDatabase();
  for (const file of ['migration_v14_v15_analytics_complete.sql', 'migration_v16_analytics_confirmed_unlinked.sql',
    'migration_v18_analytics_olist_costs.sql', 'migration_v19_analytics_cost_effective_dates.sql',
    'migration_v23_olist_api_usage.sql', 'migration_v24_analytics_resumable_import.sql'])
    await db.exec(readFileSync('supabase/' + file, 'utf8'));
  await db.exec(migration); await db.exec(migration);
  today = (await rows("SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS day"))[0].day;
  await db.query("UPDATE analytics_companies SET tax_id='11111111000191' WHERE id=$1", [connection]);
  await db.query("UPDATE analytics_connections SET enabled=(id=$1),last_synced_at=now(),verified_tax_id=CASE WHEN id=$1 THEN '11111111000191' ELSE null END", [connection]);
});
beforeEach(async () => db.exec('BEGIN'));
afterEach(async () => db.exec('ROLLBACK'));
after(async () => db?.close());

async function sale(day, external = '1', cents = '1000') {
  const [order] = await rows(`INSERT INTO analytics_orders(workspace_id,company_id,connection_id,source_id,canonical_key,
    external_id,customer_key,customer_name,sale_date,status,total_cents,fetched_at)
    VALUES($1,$2,$2,$2,$3,$4,'customer','Cliente',$5,1,$6,now()) RETURNING id`,
  [ws, connection, `olist:${connection}:${day}:${external}`, external, day, cents]);
  await db.query('INSERT INTO analytics_order_aliases VALUES($1,$2,$3,$4)', [ws, connection, external, order.id]);
}

async function expectedError(action, pattern) {
  await db.exec('SAVEPOINT expected_error');
  await assert.rejects(action, pattern);
  await db.exec('ROLLBACK TO SAVEPOINT expected_error; RELEASE SAVEPOINT expected_error');
}

test('matching day does not requeue; diverging day requeues exactly one existing import job, today before yesterday', async t => {
  const yesterday = dayAfter(today, -1);
  await sale(today, '1'); await sale(yesterday, '2');
  await db.query(`INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,status)
    VALUES($1,$2,'backfill',$3,$3,$3,'completed')`, [ws, connection, yesterday]);
  const paths = setup(t, params => params.get('dataInicial') === today
    ? { itens: [{ id: 1, situacao: 1, valor: '10.00' }], paginacao: { total: 1 } }
    : { itens: [{ id: 2, situacao: 1, valor: '10.00' }, { id: 3, situacao: 1, valor: '5.00' }], paginacao: { total: 2 } });
  assert.deepEqual(await processAnalyticsReconciliation(), { checked: 1, requeued: 0 });
  assert.equal((await rows("SELECT * FROM analytics_sync_jobs WHERE status='queued'")).length, 0);
  assert.deepEqual(await processAnalyticsReconciliation(), { checked: 1, requeued: 1 });
  assert.deepEqual(paths.map(params => params.get('dataInicial')), [today, yesterday]);
  const [repair] = await rows("SELECT *,from_date::text from_day,to_date::text to_day FROM analytics_sync_jobs WHERE status='queued'");
  assert.equal(repair.mode, 'backfill'); assert.equal(repair.lane, 'history');
  assert.equal(repair.from_day, yesterday); assert.equal(repair.to_day, yesterday);
  assert.equal(repair.query_phase, 'sales'); assert.equal(repair.covers_sales, true);
  const results = await rows('SELECT *,sale_day::text AS day FROM analytics_sales_reconciliation WHERE checked_at IS NOT NULL ORDER BY sale_day DESC');
  assert.deepEqual(results.map(result => [result.status, result.api_calls]), [['matched', 1], ['diverged', 1]]);
  assert.equal(results[1].requeued_job_id, repair.id);
  assert.equal((await rows("SELECT * FROM analytics_sync_jobs WHERE status='queued'")).length, 1);
  const next = await rows('SELECT *,sale_day::text AS day FROM analytics_claim_reconciliation($1)', [today]);
  assert.equal(next[0].day, dayAfter(today, -2), 'completed dates cannot be reconciled again today');
});

test('available sums detect equal-count divergence while unknown cancellations are excluded', async t => {
  await sale(today);
  setup(t, () => ({ itens: [{ id: 1, situacao: 1, valor: '10.01' }, { id: 99, situacao: 2, valor: '1000' }], paginacao: { total: 2 } }));
  assert.deepEqual(await processAnalyticsReconciliation(), { checked: 1, requeued: 1 });
  const [result] = await rows('SELECT * FROM analytics_sales_reconciliation WHERE checked_at IS NOT NULL');
  assert.equal(result.olist_count, 1); assert.equal(result.abc_count, 1);
  assert.equal(result.olist_total_cents, '1001'); assert.equal(result.abc_total_cents, '1000');
});

test('two complete pages use exact cents; large dates use two counts without comparing a partial sum', async t => {
  let large = false;
  const paths = setup(t, params => {
    if (params.get('situacao') === '2') return { itens: [{ id: 999, situacao: 2 }], paginacao: { total: 7 } };
    const offset = Number(params.get('offset'));
    return { itens: Array.from({ length: large || !offset ? 100 : 50 }, (_, index) => ({ id: offset + index + 1, situacao: 1, valor: '0.10' })),
      paginacao: { total: large ? 501 : 150 } };
  });
  assert.deepEqual(await processAnalyticsReconciliation(), { checked: 1, requeued: 1 });
  assert.equal((await rows('SELECT olist_total_cents FROM analytics_sales_reconciliation WHERE checked_at IS NOT NULL'))[0].olist_total_cents, '1500');
  assert.deepEqual(paths.map(params => params.get('offset')), ['0', '100']);
  large = true;
  assert.deepEqual(await processAnalyticsReconciliation(), { checked: 1, requeued: 1 });
  const [result] = await rows('SELECT * FROM analytics_sales_reconciliation WHERE sale_day=$1', [dayAfter(today, -1)]);
  assert.equal(result.olist_count, 494); assert.equal(result.olist_total_cents, null);
  assert.equal(result.api_calls, 2); assert.equal(paths[3].get('situacao'), '2');
});

test('429 stops immediately, defers the other dates and cannot exceed two calls under a lease', async t => {
  const paths = setup(t, () => { throw new provider.AnalyticsApiError(429, 120); });
  assert.ok((await processAnalyticsReconciliation()).error);
  assert.equal(paths.length, 1);
  const [failed] = await rows("SELECT * FROM analytics_sales_reconciliation WHERE status='failed'");
  assert.equal(failed.api_calls, 1); assert.equal(failed.olist_count, null); assert.equal(failed.requeued_job_id, null);
  assert.equal((await rows("SELECT count(*)::integer n FROM analytics_sales_reconciliation WHERE status='pending' AND next_at>now()+interval '110 seconds'"))[0].n, 6);
  assert.deepEqual(await processAnalyticsReconciliation(), { checked: 0, requeued: 0 });
  assert.equal(paths.length, 1);
  await db.exec('UPDATE analytics_sales_reconciliation SET next_at=now()');
  const [claimed] = await rows('SELECT *,sale_day::text AS day FROM analytics_claim_reconciliation($1)', [today]);
  const args = [connection, claimed.day, claimed.lease_token];
  await db.query('SELECT analytics_reconciliation_call($1,$2,$3)', args);
  await db.query('SELECT analytics_reconciliation_call($1,$2,$3)', args);
  await expectedError(() => db.query('SELECT analytics_reconciliation_call($1,$2,$3)', args), /CALL_LIMIT/);
  assert.equal((await rows('SELECT * FROM analytics_claim_jobs($1,3)', [ws])).length, 0, 'normal workers cannot use a reconciliation lease');
  await db.exec('SET LOCAL ROLE authenticated');
  await expectedError(() => db.query('SELECT * FROM analytics_sales_reconciliation'), /permission denied/);
  await expectedError(() => db.query('SELECT analytics_claim_reconciliation($1)', [today]), /permission denied/);
  await db.exec('RESET ROLE');
  assert.equal((await rows("SELECT relrowsecurity FROM pg_class WHERE oid='analytics_sales_reconciliation'::regclass"))[0].relrowsecurity, true);
  assert.equal((await rows("SELECT * FROM pg_policies WHERE tablename='analytics_sales_reconciliation'")).length, 0);
});

test('peak hours and insufficient remaining budget make no provider or database calls', async t => {
  setup(t, () => { throw Error('Must not query Olist'); });
  t.mock.method(admin, 'createAdminClient', () => { throw Error('Must not claim a date'); });
  assert.deepEqual(await processAnalyticsReconciliation(24999), { checked: 0, requeued: 0 });
  t.mock.method(Date, 'now', () => Date.parse(today + 'T15:00:00Z'));
  assert.deepEqual(await processAnalyticsReconciliation(), { checked: 0, requeued: 0 });
});

test('a failed repair is requeued in place and existing active repairs are never duplicated', async t => {
  const [existing] = await rows(`INSERT INTO analytics_sync_jobs(workspace_id,connection_id,mode,from_date,to_date,cursor_date,status)
    VALUES($1,$2,'backfill',$3,$3,$3,'failed') RETURNING id`, [ws, connection, today]);
  setup(t, () => ({ itens: [{ id: 1, situacao: 1, valor: '10' }], paginacao: { total: 1 } }));
  assert.deepEqual(await processAnalyticsReconciliation(), { checked: 1, requeued: 1 });
  const repairs = await rows('SELECT * FROM analytics_sync_jobs');
  assert.equal(repairs.length, 1); assert.equal(repairs[0].id, existing.id); assert.equal(repairs[0].status, 'queued');
});
