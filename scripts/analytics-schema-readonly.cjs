// Only GET/HEAD requests to the configured project. Never invokes scheduling,
// claims, ingestion, OAuth, migrations, or quota reservations.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');
const workspace = require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const directory = 'docs/evidencias/supabase-schema-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const out = { startedAt: new Date().toISOString(), readOnly: true, migrations: {}, checks: {} };
async function readFetch(url, options = {}) {
  if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase()))
    throw new Error('Read-only audit blocked a non-read request');
  return fetch(url, { ...options, signal: AbortSignal.timeout(20000) });
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: readFetch },
});
function check(response, label) {
  if (response.error) throw new Error(label + ': ' + (response.error.code || response.status));
  return response.data;
}
async function main() {
  const api = await readFetch(process.env.NEXT_PUBLIC_SUPABASE_URL + '/rest/v1/', {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_ROLE_KEY },
  });
  if (!api.ok) throw new Error('OpenAPI HTTP ' + api.status);
  const schema = await api.json();
  const paths = new Set(Object.keys(schema.paths || {}));
  const signatures = {
    v13: ['analytics_claim_jobs', 'analytics_claim_job', 'analytics_schedule_range'],
    v18: ['analytics_claim_cost_sync', 'analytics_finish_cost_page', 'analytics_seed_cost_sources'],
    v19: ['analytics_claim_cost_history', 'analytics_finish_cost_history_page', 'analytics_cost_history_status'],
    v21: ['analytics_abc_components_v21', 'analytics_drilldown_components_v21'],
    v23: ['olist_api_scope', 'olist_api_acquire', 'olist_api_record', 'olist_api_usage'],
    v24: ['analytics_import_context', 'analytics_finish_import', 'analytics_schedule_recent', 'analytics_defer_cost'],
    cron: ['invoke_analytics_sync', 'invoke_olist_token_refresh'],
  };
  for (const [version, names] of Object.entries(signatures))
    out.migrations[version] = { missingFunctions: names.filter(name => !paths.has('/rpc/' + name)) };
  const tableFields = {
    analytics_sync_jobs: 'last_claimed_at,query_phase,covers_sales',
    analytics_connections: 'refresh_lock,refresh_locked_until,refresh_expires_at,sync_locked_until',
    tiny_integrations: 'refresh_lock,refresh_locked_until,refresh_expires_at',
    analytics_product_costs: 'provider_revision,cost_cents',
    analytics_cost_history_sync: 'next_at',
    analytics_cost_events: 'effective_day,current,average_cents,purchase_cents',
    analytics_cost_event_staging: '*',
    olist_api_policies: 'plan_limit,app_limit',
    olist_api_state: 'cleanup_at',
    olist_api_minutes: 'requests,responses,timeouts,throttled',
    olist_api_samples: 'provider_limit,provider_remaining',
    olist_api_permits: 'recorded',
  };
  // HEAD checks validate columns without reading credentials or customer data.
  out.checks.columns = {};
  for (const [table, columns] of Object.entries(tableFields)) {
    const result = await db.from(table).select(columns, { head: true }).limit(1);
    out.checks.columns[table] = { ok: !result.error, code: result.error?.code || null };
  }
  const checkpoint = await db.from('analytics_sync_jobs').select('import_state,lane', { head: true }).limit(1);
  out.checks.v24Checkpoint = { ok: !checkpoint.error, code: checkpoint.error?.code || null };
  const member = check(await db.from('workspace_members').select('user_id')
    .eq('workspace_id', workspace).eq('active', true).eq('role', 'admin').limit(1), 'admin');
  if (!member[0]) throw new Error('Active workspace administrator required');
  const actor = member[0].user_id;
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const filters = { from: '2026-08-01', to: today, metric: 'quantity', mode: 'TINY_LEGACY', grouping: 'product',
    basis: 'orders', thresholdA: 80, thresholdB: 95, costBasis: 'average', selections: { statuses: ['1', '5', '6'] } };
  out.reportScope = { filters, compositionRules: 'Empty mapping, diagnostic only; not a reconciliation of real composition rules.' };
  out.checks.reports = [];
  // Only STABLE read functions. Quantity avoids requiring all historical costs.
  for (const composed of [false, true]) {
    const name = composed ? 'analytics_abc_components_v21' : 'analytics_abc';
    const started = performance.now();
    const result = await db.rpc(name, {
      p_workspace: workspace, p_actor: actor,
      p_filters: JSON.stringify({ ...filters, grouping: composed ? 'composition' : 'product' }),
      ...(composed ? { p_rules: JSON.stringify({}) } : {}),
      p_offset: 0, p_limit: 1, p_sort: 'rank', p_direction: 'asc',
    }, { get: true });
    const chart = result.data?.pareto;
    out.checks.reports.push({ function: name, ok: !result.error, errorCode: result.error?.code || null,
      durationMs: Math.round(performance.now() - started), total: result.data?.total,
      tableRows: result.data?.rows?.length, chartRows: Array.isArray(chart) ? chart.length : null,
      fullParetoObserved: !result.error && result.data?.total > 60 && Array.isArray(chart) && chart.length === result.data.total });
  }
  const history = await db.rpc('analytics_cost_history_status', { p_workspace: workspace }, { get: true });
  out.checks.costHistory = { ok: !history.error, errorCode: history.error?.code || null, status: history.data };
  const usage = await db.rpc('olist_api_usage', { p_workspace: workspace, p_actor: actor, p_minutes: 1 }, { get: true });
  out.checks.apiUsage = { ok: !usage.error, errorCode: usage.error?.code || null,
    retentionHours: usage.data?.retention_hours, accounts: usage.data?.accounts?.map(a => ({
      name: a.name, plan: a.plan, planLimit: a.plan_limit, appLimit: a.app_limit,
      effectiveLimit: a.effective_limit, observedAt: a.observed_at,
    })) };
  out.checks.retention = {};
  for (const [table, field, hours] of [['analytics_cron_runs', 'requested_at', 48],
    ['olist_api_minutes', 'minute', 48], ['olist_api_samples', 'minute', 48], ['olist_api_permits', 'started_at', 1]]) {
    const cutoff = new Date(Date.now() - hours * 3600000).toISOString();
    const [count, oldest] = await Promise.all([
      db.from(table).select('*', { head: true, count: 'exact' }).lt(field, cutoff),
      db.from(table).select(field).order(field).limit(1),
    ]);
    out.checks.retention[table] = { cutoff, cutoffHours: hours, olderRows: count.count,
      oldest: oldest.data?.[0]?.[field] || null, errorCode: count.error?.code || oldest.error?.code || null };
  }
  out.checks.cron = {};
  for (const name of ['cron', 'net']) {
    const r = await db.schema(name).from(name === 'cron' ? 'job' : '_http_response')
      .select(name === 'cron' ? 'jobname,schedule,active' : 'id,status_code,timed_out').limit(10);
    out.checks.cron[name] = r.error ? { accessibleThroughRest: false, code: r.error.code } : { accessibleThroughRest: true, rows: r.data };
  }
  // Absence of a schema-migration ledger is not an uninstalled migration.
  const ledger = await db.schema('supabase_migrations').from('schema_migrations').select('version').limit(1);
  out.checks.migrationLedger = { accessibleThroughRest: !ledger.error, code: ledger.error?.code || null };
}
main().catch(error => { out.error = error.message; process.exitCode = 1; }).finally(() => {
  out.finishedAt = new Date().toISOString();
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(directory + '/status.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({ directory, ...out }));
});
