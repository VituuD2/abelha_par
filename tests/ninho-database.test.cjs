const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const owner = '10000000-0000-4000-8000-000000000001';
const operator = '10000000-0000-4000-8000-000000000002';
const outsider = '10000000-0000-4000-8000-000000000003';
const foreignWorkspace = '10000000-0000-4000-8000-000000000004';
const session = '20000000-0000-4000-8000-000000000001';
const migrations = file => readFileSync(join(__dirname, '../supabase', file), 'utf8');
const migration = migrations('migration_v9_ninho_workspaces.sql');

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, created_at timestamptz DEFAULT now(), raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;`);
  for (const file of ['migration.sql', 'migration_v2.sql', 'migration_v3_security.sql', 'migration_v4_incremental_olist_sync.sql', 'migration_v5_batch_responsible.sql', 'migration_v6_nuvemshop_sessions.sql', 'migration_v7_olist_queue.sql', 'migration_v8_olist_token_refresh.sql']) await db.exec(migrations(file));
  await db.exec('GRANT SELECT ON lotes_bipagem TO authenticated;');
  await db.query('INSERT INTO auth.users(id) VALUES ($1),($2)', [owner, operator]);
  await db.query("INSERT INTO tiny_integrations(owner_id,access_token,refresh_token,expires_at) VALUES ($1,'encrypted-access','encrypted-refresh',now()+interval '3 hours')", [owner]);
  await db.query("INSERT INTO nuvemshop_integrations(owner_id,store_id,access_token,olist_ecommerce_id,reference_kind,reference_field) VALUES ($1,'123','encrypted-shop',23257,'number','ecommerceOrderNumber')", [owner]);
  await db.query("INSERT INTO lotes_bipagem(owner_id,responsavel,qtd_pedidos,pedidos) VALUES ($1,'Histórico',1,'[{\"yampiId\":\"legacy\"}]')", [owner]);
  await db.query('INSERT INTO olist_order_cache(owner_id,olist_order_id) VALUES ($1,123)', [owner]);
  await db.exec(migration);
  await db.exec(migration);
  // Accounts created outside Ninho are not admitted automatically by a retry.
  await db.query('INSERT INTO auth.users(id) VALUES ($1)', [outsider]);
  await db.exec(migration);
  await db.query('INSERT INTO workspaces(id) VALUES ($1)', [foreignWorkspace]);
  await db.query("INSERT INTO workspace_members(user_id,workspace_id,role) VALUES ($1,$2,'admin')", [outsider, foreignWorkspace]);
  await db.exec(migrations('migration_v10_atomic_scan.sql'));
  await db.exec(migrations('migration_v10_atomic_scan.sql'));
});

test('atomic scans preserve tracking rules, reject duplicates and return small confirmations', async () => {
  require('./setup.cjs');
  const { normalizeTrackingForScan } = require('../src/lib/tracking.ts');
  for (const code of ['', ' \t\n ', ' aa123456789br ', 'PREFIX12345612345678', '01234567890112345678', 'SHORT', '\u00a0\u2003\ufeffaa123456789br\u2028']) {
    const actual = (await db.query('SELECT normalize_scan_tracking($1) AS value', [code])).rows[0].value;
    assert.equal(actual, normalizeTrackingForScan(code), code);
  }
  const scanId = '20000000-0000-4000-8000-000000000010';
  const orders = Array.from({ length: 1000 }, (_, i) => ({ id: i + 1, clientName: `Cliente ${i + 1}`, trackingCode: i === 0 ? 'AA123456789BR' : `CODE${i + 1}`, status: 'pending' }));
  await db.query('INSERT INTO scan_sessions(id,owner_id,workspace_id,responsible,orders) VALUES ($1,$2,$2,$3,$4)', [scanId,owner,'Equipe',JSON.stringify(orders)]);
  const scan = async (code, revision) => (await db.query('SELECT submit_workspace_scan($1,$2,$3,$4,$5) AS payload', [owner,operator,scanId,code,revision])).rows[0].payload;
  const first = await scan(' aa123456789br ', 0);
  assert.equal(first.session, undefined); assert.equal(first.result.type, 'success');
  assert.equal(first.result.order.status, 'checked'); assert.ok(first.result.order.scannedAt);
  assert.deepEqual(first.confirmation, { sessionId: scanId, revision: 1, scannedCount: 1, totalCount: 1000 });
  assert.ok(JSON.stringify(first).length < 1000);
  const duplicate = await scan('AA123456789BR', 1);
  assert.equal(duplicate.result.type, 'error'); assert.match(duplicate.result.message, /já bipado/);
  assert.equal(duplicate.confirmation.revision, 1);
  const missing = await scan('UNKNOWN', 1);
  assert.equal(missing.result.type, 'error'); assert.equal(missing.confirmation.scannedCount, 1);
  const stale = await scan('CODE2', 0);
  assert.equal(stale.session.orders[0].status, 'checked'); assert.equal(stale.session.orders[1].status, 'checked');
  assert.equal(stale.confirmation.revision, 2);
  const stored = (await db.query('SELECT * FROM scan_sessions WHERE id=$1', [scanId])).rows[0];
  assert.equal(stored.owner_id, owner); assert.equal(stored.last_updated_by, operator);
});

test('atomic scans serialize competing readers, reject ambiguous labels and protect workspace access', async () => {
  const scanId = '20000000-0000-4000-8000-000000000011';
  const orders = [{ id: 1, clientName: 'A', trackingCode: '01234567890112345678', status: 'pending' }, { id: 2, trackingCode: 'OTHER', status: 'pending' }];
  await db.query('INSERT INTO scan_sessions(id,owner_id,workspace_id,responsible,orders) VALUES ($1,$2,$2,$3,$4)', [scanId,owner,'Equipe',JSON.stringify(orders)]);
  const scan = (actor, code, revision = 0, workspace = owner) => db.query('SELECT submit_workspace_scan($1,$2,$3,$4,$5) AS payload', [workspace,actor,scanId,code,revision]);
  const [a,b] = await Promise.all([scan(operator,'12345678'), scan(owner,'12345678')]);
  assert.deepEqual([a.rows[0].payload.result.type,b.rows[0].payload.result.type].sort(), ['error','success']);
  const stale = await db.query("UPDATE scan_sessions SET orders=$1 WHERE id=$2 AND revision=0 RETURNING id", [JSON.stringify(orders),scanId]);
  assert.equal(stale.rows.length, 0);
  await assert.rejects(scan(outsider,'OTHER'), /MEMBER_REQUIRED/);
  await assert.rejects(scan(outsider,'OTHER',0,foreignWorkspace), /SESSION_NOT_FOUND/);
  await db.query('UPDATE workspace_members SET active=false WHERE user_id=$1', [operator]);
  await assert.rejects(scan(operator,'OTHER'), /MEMBER_REQUIRED/);
  await db.query('UPDATE workspace_members SET active=true WHERE user_id=$1', [operator]);
  for (const role of ['anon','authenticated']) {
    assert.equal((await db.query("SELECT has_function_privilege($1,'submit_workspace_scan(uuid,uuid,uuid,text,integer)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
  }
  assert.equal((await scan(owner,'OTHER',null)).rows[0].payload.session.orders.length, 2);
  await db.query("UPDATE scan_sessions SET status='completed' WHERE id=$1", [scanId]);
  await assert.rejects(scan(owner,'OTHER'), /SESSION_CLOSED/);
  await db.query("UPDATE scan_sessions SET status='active',orders=$1 WHERE id=$2", [JSON.stringify([{ ...orders[0], trackingCode: '12345678' }, orders[0]]),scanId]);
  const ambiguous = (await scan(owner,'12345678')).rows[0].payload;
  assert.equal(ambiguous.result.type, 'error'); assert.match(ambiguous.result.message, /mais de um pedido/);
});
after(async () => db.close());

test('migration preserves encrypted credentials, history, webhook ID and creator, and initializes roles once', async () => {
  const tiny = (await db.query('SELECT * FROM tiny_integrations')).rows[0];
  assert.equal(tiny.workspace_id, owner); assert.equal(tiny.access_token, 'encrypted-access'); assert.equal(tiny.refresh_token, 'encrypted-refresh');
  const shop = (await db.query('SELECT * FROM nuvemshop_integrations')).rows[0];
  assert.equal(shop.workspace_id, owner); assert.equal(shop.access_token, 'encrypted-shop'); assert.equal(Number(shop.olist_ecommerce_id), 23257);
  const batch = (await db.query('SELECT * FROM lotes_bipagem')).rows[0];
  assert.equal(batch.workspace_id, owner); assert.equal(batch.owner_id, owner); assert.equal(batch.pedidos[0].yampiId, 'legacy');
  const members = (await db.query('SELECT * FROM workspace_members WHERE workspace_id=$1 ORDER BY user_id', [owner])).rows;
  assert.equal(members.length, 2); assert.equal(members[0].role, 'admin'); assert.equal(members[1].role, 'operator');
  for (const table of ['tiny_integrations','nuvemshop_integrations','olist_order_cache','workspace_members']) {
    assert.equal((await db.query("SELECT has_table_privilege('authenticated',$1,'UPDATE') AS allowed",[table])).rows[0].allowed,false);
  }
  assert.equal((await db.query("SELECT has_table_privilege('authenticated','tiny_integrations','SELECT') AS allowed")).rows[0].allowed,false);
});

async function visibleBatches(actor) {
  return db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE authenticated');
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor]);
    return (await tx.query('SELECT id FROM lotes_bipagem')).rows;
  });
}
test('operators read shared history through RLS; foreign and blocked members cannot', async () => {
  assert.equal((await visibleBatches(operator)).length, 1);
  assert.equal((await visibleBatches(outsider)).length, 0);
  await db.query("SELECT update_workspace_member($1,$2,$3,'operator',false)", [owner,owner,operator]);
  assert.equal((await visibleBatches(operator)).length, 0);
  await db.query("SELECT update_workspace_member($1,$2,$3,'operator',true)", [owner,owner,operator]);
});

test('membership RPC rejects operators, foreign admins and removal of the last active admin', async () => {
  await assert.rejects(db.query("SELECT update_workspace_member($1,$2,$3,'admin',true)",[owner,operator,operator]), /ADMIN_REQUIRED/);
  await assert.rejects(db.query("SELECT update_workspace_member($1,$2,$3,'admin',true)",[owner,outsider,operator]), /ADMIN_REQUIRED/);
  await assert.rejects(db.query("SELECT update_workspace_member($1,$2,$3,'operator',true)",[owner,owner,owner]), /LAST_ADMIN/);
  await assert.rejects(db.query("SELECT update_workspace_member($1,$2,$3,'admin',false)",[owner,owner,owner]), /LAST_ADMIN/);
  assert.equal((await db.query("SELECT has_function_privilege('authenticated','update_workspace_member(uuid,uuid,uuid,text,boolean)','EXECUTE') AS allowed")).rows[0].allowed,false);
});

test('an operator finalizes a shared session created by another member, preserving authorship and idempotency', async () => {
  const checked = [{ id: 123, status: 'checked', trackingCode: 'TRACK', scannedAt: new Date().toISOString() }];
  await db.query('INSERT INTO scan_sessions(id,owner_id,workspace_id,responsible,orders) VALUES ($1,$2,$2,$3,$4)',[session,owner,'Equipe',JSON.stringify(checked)]);
  await assert.rejects(db.query('SELECT * FROM finish_workspace_scan_session($1,$2,$3)',[owner,outsider,session]), /MEMBER_REQUIRED/);
  const a = (await db.query('SELECT * FROM finish_workspace_scan_session($1,$2,$3)',[owner,operator,session])).rows[0];
  const b = (await db.query('SELECT * FROM finish_workspace_scan_session($1,$2,$3)',[owner,owner,session])).rows[0];
  assert.equal(a.id,b.id); assert.equal(a.owner_id,owner); assert.equal(a.finished_by,operator); assert.equal(a.workspace_id,owner);
  assert.equal((await visibleBatches(operator)).length,2);
  await assert.rejects(db.query('SELECT * FROM finish_workspace_scan_session($1,$2,$3)',[foreignWorkspace,outsider,session]), /SESSION_NOT_FOUND/);
});

test('shared cache and queue accept workspace writes while legacy inserts stay compatible', async () => {
  await db.query('INSERT INTO olist_order_cache(workspace_id,olist_order_id) VALUES ($1,456)',[owner]);
  assert.equal((await db.query('SELECT owner_id FROM olist_order_cache WHERE olist_order_id=456')).rows[0].owner_id,owner);
  await db.query('SELECT enqueue_workspace_olist_sync_jobs($1,$2,true)',[owner,[123,123]]);
  await db.query('SELECT enqueue_olist_sync_jobs($1,$2,true)',[owner,[123]]);
  const jobs = (await db.query('SELECT * FROM claim_olist_sync_jobs(5)')).rows;
  assert.equal(jobs.length,1); assert.equal(jobs[0].workspace_id,owner);
});

test('webhook changes require admin and rotating the URL resets receipt without changing tokens', async () => {
  await assert.rejects(db.query("SELECT configure_workspace_webhook($1,$2,'rotate')",[owner,operator]), /ADMIN_REQUIRED/);
  await db.query('INSERT INTO olist_sync_state(workspace_id,last_webhook_at) VALUES ($1,now())',[owner]);
  await db.query("SELECT configure_workspace_webhook($1,$2,'rotate')",[owner,owner]);
  assert.equal((await db.query('SELECT olist_webhook_revision FROM workspaces WHERE id=$1',[owner])).rows[0].olist_webhook_revision,1);
  assert.equal((await db.query('SELECT last_webhook_at FROM olist_sync_state')).rows[0].last_webhook_at,null);
  await db.query("SELECT configure_workspace_webhook($1,$2,'disable')",[owner,owner]);
  assert.equal((await db.query('SELECT olist_webhook_enabled FROM workspaces WHERE id=$1',[owner])).rows[0].olist_webhook_enabled,false);
  assert.equal((await db.query('SELECT refresh_token FROM tiny_integrations')).rows[0].refresh_token,'encrypted-refresh');
  await db.exec(migration);
  assert.equal((await db.query('SELECT olist_webhook_revision,olist_webhook_enabled FROM workspaces WHERE id=$1',[owner])).rows[0].olist_webhook_revision,1);
  assert.equal((await db.query('SELECT olist_webhook_enabled FROM workspaces WHERE id=$1',[owner])).rows[0].olist_webhook_enabled,false);
});
