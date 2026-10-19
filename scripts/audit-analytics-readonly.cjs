// Only GET requests. Never calls OAuth refresh, sync, scheduling, or write RPCs.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) },
});
async function main() {
  const output = { at: new Date().toISOString(), mode: 'read-only GET; no token refresh', tables: {}, http: [] };
  const queries = {
    analytics_companies: 'id,workspace_id,name,tax_id',
    analytics_connections: 'id,workspace_id,company_id,name,enabled,credential_kind,legacy_integration_id,verified_at,verified_tax_id,expires_at,last_synced_at,error_code',
    analytics_sync_jobs: 'connection_id,mode,status,from_date,to_date,cursor_date,page_offset,pending_index,processed,pages,attempts,next_at,updated_at,error_code,last_error,query_phase,covers_sales',
    analytics_cron_runs: 'requested_at,request_id',
  };
  for (const [table, columns] of Object.entries(queries)) {
    let q = db.from(table).select(columns, { count: 'exact' });
    if (table === 'analytics_cron_runs') q = q.order('requested_at', { ascending: false }).limit(10);
    else q = q.limit(1000);
    const r = await q;
    output.tables[table] = r.error ? { errorCode: r.error.code, message: r.error.message } : { count: r.count, rows: r.data };
  }
  const v13 = await db.from('analytics_sync_jobs').select('last_claimed_at').limit(1);
  output.v13Column = v13.error ? { code: v13.error.code, message: v13.error.message } : 'present';
  for (const schema of ['cron', 'net']) {
    const r = await db.schema(schema).from(schema === 'cron' ? 'job' : '_http_response').select(schema === 'cron' ? 'jobname,schedule,active' : 'id,status_code,timed_out').limit(10);
    output[schema] = r.error ? { code: r.error.code, message: r.error.message } : r.data;
  }
  for (const table of ['analytics_orders', 'analytics_items', 'analytics_products', 'analytics_order_aliases', 'analytics_sources', 'tiny_integrations']) {
    const r = await db.from(table).select('*', { count: 'exact', head: true });
    output.tables[table] = { count: r.count, errorCode: r.error?.code || null };
  }
  // Explicitly allowlisted STABLE report functions, invoked with HTTP GET only.
  const workspace = output.tables.analytics_companies.rows?.[0]?.workspace_id;
  if (workspace) {
    const member = await db.from('workspace_members').select('user_id').eq('workspace_id', workspace).eq('active', true).eq('role', 'admin').limit(1);
    const actor = member.data?.[0]?.user_id;
    if (actor) {
      const filters = { from:'2026-08-01',to:'2026-10-08',metric:'revenue',mode:'TINY_LEGACY',grouping:'product',basis:'orders',thresholdA:80,thresholdB:95,selections:{statuses:['1','5','6']} };
      const { rankABC } = require('../src/lib/analytics/engine.ts');
      output.reports = [];
      const companies = output.tables.analytics_companies.rows;
      const byName = name => companies.find(c=>c.name === name)?.id;
      for (const names of [[],['Olist 1'],['Olist 2'],['Olist 3'],['Olist 1','Olist 3'],['Olist 1','Olist 2']]) {
        const f = {...filters,selections:{...filters.selections,companies:names.map(byName)}};
        const start = performance.now();
        const r = await db.rpc('analytics_abc',{p_workspace:workspace,p_actor:actor,p_filters:JSON.stringify(f),p_offset:0,p_limit:-1,p_sort:'rank',p_direction:'asc'},{get:true});
        if (r.error) { output.reports.push({names,error:r.error.code});continue; }
        const expected=rankABC(r.data.rows);
        output.reports.push({names:names.length?names:['Todas'],ms:Math.round(performance.now()-start),orders:r.data.orders,entities:r.data.total,grossCents:r.data.revenue,rankOrClassDifferences:r.data.rows.filter((row,i)=>row.class!==expected[i].class||row.entityId!==expected[i].entityId||row.rank!==expected[i].rank).length});
      }
      const cov = await db.rpc('analytics_coverage',{p_workspace:workspace,p_actor:actor},{get:true});
      output.coverage = cov.error ? {error:cov.error.code} : cov.data;
    }
  }
  // Probe function signatures through the REST OpenAPI document; no functions execute.
  try {
    const r = await fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/', {
      headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY },
      signal: AbortSignal.timeout(15000),
    });
    const schema = await r.json();
    output.rpcSignatures = Object.keys(schema.paths || {}).filter(p => p.includes('analytics_'));
  } catch { output.rpcSignatures = 'unavailable'; }
  for (const path of ['/analytics/abc', '/api/analytics/options', '/api/analytics/sync', '/api/internal/analytics-sync']) {
    try {
      const r = await fetch(new URL(path, process.env.APP_URL), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
      output.http.push({ path, status: r.status, location: r.headers.get('location'), server: r.headers.get('server') });
    } catch { output.http.push({ path, error: 'network/timeout' }); }
  }
  fs.mkdirSync('docs/evidencias/curva-abc-2026-10-16', { recursive: true });
  fs.writeFileSync('docs/evidencias/curva-abc-2026-10-16/ambiente-readonly.json', JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}
require('../tests/setup.cjs');
main().catch(() => { console.error('Read-only audit failed; no secrets printed.'); process.exitCode = 1; });
