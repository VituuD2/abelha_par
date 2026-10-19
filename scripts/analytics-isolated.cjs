const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const ws = '11000000-0000-4000-8000-000000000001';
const connections = [1, 2, 3].map(i => '22000000-0000-4000-8000-00000000000' + i);
const sql = file => readFileSync(join(__dirname, '../supabase', file), 'utf8');
async function isolatedDatabase() {
  const db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,created_at timestamptz DEFAULT now(),raw_user_meta_data jsonb DEFAULT '{}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for (const f of ['migration.sql', 'migration_v2.sql', 'migration_v3_security.sql', 'migration_v4_incremental_olist_sync.sql',
    'migration_v5_batch_responsible.sql', 'migration_v6_nuvemshop_sessions.sql', 'migration_v7_olist_queue.sql', 'migration_v8_olist_token_refresh.sql']) await db.exec(sql(f));
  await db.query('INSERT INTO auth.users(id) VALUES($1)', [ws]);
  for (const f of ['migration_v9_ninho_workspaces.sql', 'migration_v10_atomic_scan.sql', 'migration_v11_analytics_abc.sql', 'migration_v12_analytics_automation.sql', 'migration_v13_analytics_parallel.sql']) await db.exec(sql(f));
  for (const [i, c] of connections.entries()) {
    await db.query('INSERT INTO analytics_companies(id,workspace_id,name) VALUES($1,$2,$3)', [c, ws, 'Olist ' + (i + 1)]);
    await db.query("INSERT INTO analytics_connections(id,workspace_id,company_id,name,verified_at) VALUES($1,$2,$1,$3,now())", [c, ws, 'Olist ' + (i + 1)]);
    await db.query("INSERT INTO analytics_sources(id,workspace_id,connection_id,external_id,name) VALUES($1,$2,$1,'1',$3)", [c, ws, 'Canal ' + (i + 1)]);
  }
  return db;
}
const filters = { from: '2026-09-01', to: '2026-09-30', metric: 'revenue', mode: 'TINY_LEGACY', grouping: 'product', basis: 'orders', thresholdA: 80, thresholdB: 95, selections: { statuses: ['1','5','6'] } };
async function query(db, f = filters, offset = 0, limit = 50, sort = 'rank', direction = 'asc') {
  return (await db.query('SELECT analytics_abc($1,$2,$3,$4,$5,$6,$7) result', [ws, ws, JSON.stringify(f), offset, limit, sort, direction])).rows[0].result;
}
module.exports = { isolatedDatabase, ws, connections, filters, query };
