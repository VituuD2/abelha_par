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
