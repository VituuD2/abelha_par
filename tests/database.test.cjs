const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const session = '20000000-0000-4000-8000-000000000001';
const order = { id: 393310669, nuvemshopId: 2083401789, nuvemshopNumber: '116', trackingCode: 'AA123456789BR', status: 'pending' };
const migration = file => readFileSync(join(__dirname, '../supabase', file), 'utf8');

before(async () => {
  // Supabase-managed roles and auth schema, reproduced in an isolated local database.
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  for (const file of ['migration.sql', 'migration_v2.sql', 'migration_v3_security.sql', 'migration_v4_incremental_olist_sync.sql', 'migration_v5_batch_responsible.sql']) await db.exec(migration(file));
  await db.exec('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role, authenticated; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;');
  await db.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [owner, other]);
  await db.query("INSERT INTO lotes_bipagem(owner_id, responsavel, qtd_pedidos, pedidos) VALUES ($1, 'Legado', 1, '[{\"yampiId\":\"legacy\"}]')", [owner]);
  for (const file of ['migration_v6_nuvemshop_sessions.sql', 'migration_v7_olist_queue.sql', 'migration_v8_olist_token_refresh.sql']) {
    await db.exec(migration(file));
    await db.exec(migration(file)); // Deployment retry must preserve existing data.
  }
});

test('OAuth refresh lease is exclusive and stale workers cannot overwrite a reconnect or release a newer lease', async () => {
  const lockA = '30000000-0000-4000-8000-000000000001';
  const lockB = '30000000-0000-4000-8000-000000000002';
  await db.query("INSERT INTO tiny_integrations(owner_id,access_token,refresh_token,expires_at) VALUES ($1,'encrypted-access','encrypted-refresh',now())", [owner]);
  const claim = lock => db.query(`UPDATE tiny_integrations SET refresh_lock=$1,refresh_locked_until=now()+interval '90 seconds'
    WHERE owner_id=$2 AND refresh_token='encrypted-refresh' AND (refresh_locked_until IS NULL OR refresh_locked_until<now()) RETURNING id`, [lock,owner]);
  const claims = await Promise.all([claim(lockA),claim(lockB)]);
  assert.equal(claims.reduce((n,r)=>n+r.rows.length,0),1);
  await db.query("UPDATE tiny_integrations SET refresh_locked_until=now()-interval '1 second' WHERE owner_id=$1", [owner]);
  assert.equal((await claim(lockB)).rows.length,1);
  assert.equal((await db.query('UPDATE tiny_integrations SET refresh_lock=null WHERE owner_id=$1 AND refresh_lock=$2 RETURNING id',[owner,lockA])).rows.length,0);
  await db.query("UPDATE tiny_integrations SET refresh_token='reconnected',refresh_lock=null,refresh_locked_until=null WHERE owner_id=$1",[owner]);
  assert.equal((await db.query("UPDATE tiny_integrations SET refresh_token='stale' WHERE owner_id=$1 AND refresh_token='encrypted-refresh' AND refresh_lock=$2 RETURNING id",[owner,lockB])).rows.length,0);
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','tiny_integrations','SELECT') AS allowed")).rows[0].allowed,false);
});
after(async () => db.close());

test('migrations retain history and prevent browser writes to sessions, credentials and batches', async () => {
  assert.equal((await db.query("SELECT pedidos->0->>'yampiId' AS reference FROM lotes_bipagem")).rows[0].reference, 'legacy');
  for (const table of ['nuvemshop_integrations', 'nuvemshop_order_cache', 'scan_sessions', 'lotes_bipagem']) {
    assert.equal((await db.query("SELECT has_table_privilege('authenticated', $1, 'INSERT') AS allowed", [table])).rows[0].allowed, false);
  }
  assert.equal((await db.query("SELECT has_function_privilege('authenticated', 'finish_scan_session(uuid,uuid)', 'EXECUTE') AS allowed")).rows[0].allowed, false);
});
test('finalization rejects incomplete and foreign sessions and returns the same batch after a retry', async () => {
  await db.query('INSERT INTO scan_sessions(id, owner_id, responsible, orders) VALUES ($1,$2,$3,$4)', [session, owner, 'Operador', JSON.stringify([order])]);
  await assert.rejects(db.query('SELECT * FROM finish_scan_session($1,$2)', [owner, session]), /SESSION_INCOMPLETE/);
  await assert.rejects(db.query('SELECT * FROM finish_scan_session($1,$2)', [other, session]), /SESSION_NOT_FOUND/);
  await db.query('UPDATE scan_sessions SET orders=$1 WHERE id=$2', [JSON.stringify([{ ...order, status: 'checked', scannedAt: new Date().toISOString() }]), session]);
  const [a, b] = await Promise.all([db.query('SELECT * FROM finish_scan_session($1,$2)', [owner, session]), db.query('SELECT * FROM finish_scan_session($1,$2)', [owner, session])]);
  assert.equal(a.rows[0].id, b.rows[0].id);
  assert.equal(a.rows[0].qtd_pedidos, 1);
  assert.equal((await db.query('SELECT count(*)::int AS total FROM lotes_bipagem WHERE session_id=$1', [session])).rows[0].total, 1);
});
test('revision comparison prevents a late tracking update from overwriting a scan', async () => {
  const id = '20000000-0000-4000-8000-000000000002';
  await db.query('INSERT INTO scan_sessions(id,owner_id,responsible,orders) VALUES ($1,$2,$3,$4)', [id, owner, 'Operador', JSON.stringify([order])]);
  const changed = JSON.stringify([{ ...order, status: 'checked', scannedAt: new Date().toISOString() }]);
  const first = await db.query('UPDATE scan_sessions SET orders=$1, revision=revision+1 WHERE id=$2 AND revision=0 RETURNING id', [changed, id]);
  const stale = await db.query('UPDATE scan_sessions SET orders=$1, revision=revision+1 WHERE id=$2 AND revision=0 RETURNING id', [JSON.stringify([order]), id]);
  assert.equal(first.rows.length, 1);
  assert.equal(stale.rows.length, 0);
  assert.equal((await db.query("SELECT orders->0->>'status' AS status FROM scan_sessions WHERE id=$1", [id])).rows[0].status, 'checked');
});
test('webhook arriving during processing is queued again; expired workers cannot finish a reclaimed job', async () => {
  await db.query('SELECT enqueue_olist_sync_jobs($1,$2,true)', [owner, [123]]);
  const first = (await db.query('SELECT * FROM claim_olist_sync_jobs(5)')).rows[0];
  await db.query('SELECT enqueue_olist_sync_jobs($1,$2,true)', [owner, [123]]);
  await db.query('SELECT finish_olist_sync_job($1,$2)', [first.id, first.lock_token]);
  assert.equal((await db.query('SELECT status FROM olist_sync_jobs WHERE id=$1', [first.id])).rows[0].status, 'queued');
  const second = (await db.query('SELECT * FROM claim_olist_sync_jobs(5)')).rows[0];
  await db.query("UPDATE olist_sync_jobs SET locked_at=now()-interval '10 minutes' WHERE id=$1", [first.id]);
  const reclaimed = (await db.query('SELECT * FROM claim_olist_sync_jobs(5)')).rows[0];
  assert.notEqual(second.lock_token, reclaimed.lock_token);
  await db.query('SELECT finish_olist_sync_job($1,$2)', [first.id, second.lock_token]);
  assert.equal((await db.query('SELECT status FROM olist_sync_jobs WHERE id=$1', [first.id])).rows[0].status, 'processing');
  await db.query('SELECT finish_olist_sync_job($1,$2)', [first.id, reclaimed.lock_token]);
  assert.equal((await db.query('SELECT status FROM olist_sync_jobs WHERE id=$1', [first.id])).rows[0].status, 'completed');
});
