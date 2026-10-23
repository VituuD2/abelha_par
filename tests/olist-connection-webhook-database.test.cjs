const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migration = readFileSync(join(__dirname, '../supabase/migrations/20261023024000_olist_connection_webhooks.sql'), 'utf8');
const db = new PGlite();
const workspace = '10000000-0000-4000-8000-000000000001';
const ids = [1, 2, 3].map(n => `20000000-0000-4000-8000-00000000000${n}`);
const receipt = '2026-10-22T23:00:00.000Z';
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
let original, access;

async function securityState() {
  const [table] = await query(`SELECT relrowsecurity, relforcerowsecurity, relacl::text
    FROM pg_class WHERE oid = 'public.analytics_connections'::regclass`);
  const policies = await query(`SELECT * FROM pg_policies WHERE schemaname = 'public' AND tablename = 'analytics_connections'`);
  return { table, policies };
}

before(async () => {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE workspaces(id uuid PRIMARY KEY);
    CREATE TABLE tiny_integrations(id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id));
    CREATE TABLE analytics_connections(
      id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id), name text NOT NULL,
      credential_kind text NOT NULL DEFAULT 'oauth', legacy_integration_id uuid REFERENCES tiny_integrations(id)
    );
    CREATE TABLE olist_sync_state(workspace_id uuid PRIMARY KEY REFERENCES workspaces(id), last_webhook_at timestamptz);
    ALTER TABLE analytics_connections ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON analytics_connections FROM anon, authenticated;
    GRANT ALL ON analytics_connections TO service_role;`);
  await db.query('INSERT INTO workspaces(id) VALUES ($1)', [workspace]);
  await db.query('INSERT INTO tiny_integrations(id,workspace_id) VALUES ($1,$2)', [ids[1], workspace]);
  await db.query('INSERT INTO olist_sync_state(workspace_id,last_webhook_at) VALUES ($1,$2)', [workspace, receipt]);
  for (let i = 0; i < ids.length; i++) {
    await db.query('INSERT INTO analytics_connections(id,workspace_id,name,credential_kind,legacy_integration_id) VALUES ($1,$2,$3,$4,$5)',
      [ids[i], workspace, `Olist ${i + 1}`, i === 1 ? 'legacy' : 'oauth', i === 1 ? ids[1] : null]);
  }
  access = await securityState();
  await db.exec(migration);
  original = await query('SELECT * FROM analytics_connections ORDER BY id');
});
after(async () => db.close());

test('existing connections receive independent random secrets; only the linked legacy connection inherits receipt time', () => {
  assert.equal(original.length, 3);
  assert.equal(new Set(original.map(row => row.webhook_secret)).size, 3);
  for (let i = 0; i < original.length; i++) {
    assert.match(original[i].webhook_secret, /^[a-f0-9]{64}$/);
    assert.equal(original[i].webhook_last_received_at?.toISOString() ?? null, i === 1 ? receipt : null);
  }
});

test('rerunning preserves secrets, recorded receipts and intentionally cleared legacy receipts', async () => {
  const updatedReceipt = '2026-10-23T00:00:00.000Z';
  await db.query('UPDATE analytics_connections SET webhook_last_received_at=$2 WHERE id=$1', [ids[0], updatedReceipt]);
  await db.query('UPDATE analytics_connections SET webhook_last_received_at=NULL WHERE id=$1', [ids[1]]);
  await db.exec(migration);
  const current = await query('SELECT * FROM analytics_connections ORDER BY id');
  assert.deepEqual(current.map(row => row.webhook_secret), original.map(row => row.webhook_secret));
  assert.deepEqual(current.map(row => row.webhook_last_received_at?.toISOString() ?? null), [updatedReceipt, null, null]);
});

test('new connections automatically receive distinct secrets and cannot duplicate another connection identity', async () => {
  const [created] = await query('INSERT INTO analytics_connections(id,workspace_id,name) VALUES (gen_random_uuid(),$1,$2) RETURNING *', [workspace, 'Olist nova']);
  assert.match(created.webhook_secret, /^[a-f0-9]{64}$/);
  assert.ok(original.every(row => row.webhook_secret !== created.webhook_secret));
  assert.equal(created.webhook_last_received_at, null);
  await assert.rejects(db.query('UPDATE analytics_connections SET webhook_secret=$1 WHERE id=$2', [original[0].webhook_secret, created.id]), /duplicate key/);
  await assert.rejects(db.query('UPDATE analytics_connections SET webhook_secret=NULL WHERE id=$1', [created.id]), /null value/);
});

test('migration keeps RLS, policies and table grants unchanged; browser roles cannot read webhook credentials', async () => {
  assert.deepEqual(await securityState(), access);
  for (const role of ['anon', 'authenticated']) {
    const [privilege] = await query("SELECT has_table_privilege($1,'public.analytics_connections','SELECT') allowed", [role]);
    assert.equal(privilege.allowed, false);
    try {
      await db.exec(`SET ROLE ${role}`);
      await assert.rejects(db.query('SELECT webhook_secret FROM analytics_connections'), /permission denied/);
    } finally {
      await db.exec('RESET ROLE');
    }
  }
  const [server] = await query("SELECT has_table_privilege('service_role','public.analytics_connections','SELECT') allowed");
  assert.equal(server.allowed, true);
});
