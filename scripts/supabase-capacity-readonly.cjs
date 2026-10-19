// Production read-only inspection: Metrics API, table counts and a STABLE report.
// No OAuth refresh, scheduling, claims, ingestion, migrations or load testing.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');
const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
const directory = `docs/evidencias/supabase-capacidade-${stamp}`;
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) },
});
const result = { startedAt: new Date().toISOString(), readOnly: true, snapshots: [], counts: {}, reports: [] };
fs.mkdirSync(directory, { recursive: true });
function save() { fs.writeFileSync(`${directory}/medicao.json`, JSON.stringify(result, null, 2)); }
function checked(response, label) {
  if (response.error) throw new Error(`${label}: ${response.error.code || response.status}`);
  return response.data;
}
const metricNames = new Set([
  'node_cpu_seconds_total', 'node_memory_MemTotal_bytes', 'node_memory_MemAvailable_bytes',
  'node_memory_SwapTotal_bytes', 'node_memory_SwapFree_bytes', 'node_load1', 'node_load5',
  'node_filesystem_size_bytes', 'node_filesystem_avail_bytes', 'node_disk_io_time_seconds_total',
  'node_vmstat_pswpin', 'node_vmstat_pswpout', 'pg_database_size_bytes',
  'max_connections_connection_count', 'pg_stat_database_num_backends',
  'pg_stat_database_deadlocks_total', 'pg_stat_database_temp_bytes_total',
  'pg_stat_database_xact_commit_total', 'pg_stat_database_xact_rollback_total',
  'pgbouncer_pools_client_waiting_connections', 'pgbouncer_pools_server_active_connections',
]);
async function metrics() {
  const response = await fetch(new URL('/customer/v1/privileged/metrics', process.env.NEXT_PUBLIC_SUPABASE_URL), {
    headers: { Authorization: `Basic ${Buffer.from(`service_role:${process.env.SUPABASE_SERVICE_ROLE_KEY}`).toString('base64')}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Metrics HTTP ${response.status}`);
  const selected = [];
  for (const line of (await response.text()).split('\n')) {
    const match = line.match(/^(\w+)(?:\{(.*?)\})?\s+([-+\d.eE]+)(?:\s+\d+)?$/);
    if (!match || !metricNames.has(match[1])) continue;
    const labels = {};
    // Retain only technical labels; exclude project references and query text.
    for (const [, key, value] of (match[2] || '').matchAll(/(\w+)="([^"\\]*)"/g))
      if (['cpu', 'mode', 'datname', 'device', 'mountpoint', 'fstype', 'state'].includes(key)) labels[key] = value;
    selected.push({ name: match[1], labels, value: Number(match[3]) });
  }
  return { at: new Date().toISOString(), metrics: selected };
}
function total(snapshot, name, predicate = () => true) {
  const rows = snapshot.metrics.filter(m => m.name === name && predicate(m));
  return rows.length ? rows.reduce((sum, m) => sum + m.value, 0) : null;
}
async function main() {
  result.snapshots.push(await metrics()); save();
  console.log(JSON.stringify({ directory, baselineAt: result.snapshots[0].at }));
  for (const table of ['analytics_orders', 'analytics_items', 'analytics_products', 'analytics_sync_jobs', 'analytics_cron_runs']) {
    const response = await db.from(table).select('*', { head: true, count: 'exact' });
    checked(response, table); result.counts[table] = response.count;
  }
  result.connections = checked(await db.from('analytics_connections').select('name,enabled,last_synced_at,error_code'), 'connections');
  const scopes = checked(await db.from('analytics_connections').select('workspace_id'), 'scope');
  const workspace = scopes[0]?.workspace_id;
  if (!workspace || scopes.some(c => c.workspace_id !== workspace)) throw new Error('A single authorized workspace is required');
  const members = checked(await db.from('workspace_members').select('user_id').eq('workspace_id', workspace).eq('active', true).eq('role', 'admin').limit(1), 'member');
  if (!members[0]) throw new Error('Active administrator required for the scoped report');
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
  const filters = { from: '2026-08-01', to: today, metric: 'revenue', mode: 'TINY_LEGACY', grouping: 'product', basis: 'orders', thresholdA: 80, thresholdB: 95, selections: { statuses: ['1', '5', '6'] } };
  result.reportScope = { filters, limit: 50, sequentialRequests: 3 };
  for (let sample = 0; sample < 3; sample++) {
    const started = performance.now();
    const data = checked(await db.rpc('analytics_abc', { p_workspace: workspace, p_actor: members[0].user_id, p_filters: JSON.stringify(filters), p_offset: 0, p_limit: 50, p_sort: 'rank', p_direction: 'asc' }, { get: true }), 'report');
    result.reports.push({ milliseconds: Math.round(performance.now() - started), responseBytes: Buffer.byteLength(JSON.stringify(data)), rows: data.rows?.length, entities: data.total, orders: data.orders });
  }
  save();
  console.log(JSON.stringify({ counts: result.counts, reports: result.reports, waitingForSecondMetricsSnapshot: true }));
  // Metrics refresh about once a minute; do not repeatedly scrape unchanged data.
  const remaining = Math.max(0, Date.parse(result.snapshots[0].at) + 65000 - Date.now());
  for (let left = remaining; left > 0; left -= 30000)
    await new Promise(resolve => setTimeout(resolve, Math.min(30000, left)));
  result.snapshots.push(await metrics());
  const [a, b] = result.snapshots;
  const delta = name => { const x = total(a, name), y = total(b, name); return x === null || y === null || y < x ? null : y - x; };
  const cpuA = total(a, 'node_cpu_seconds_total'), cpuB = total(b, 'node_cpu_seconds_total');
  const idleA = total(a, 'node_cpu_seconds_total', m => m.labels.mode === 'idle');
  const idleB = total(b, 'node_cpu_seconds_total', m => m.labels.mode === 'idle');
  result.summary = {
    windowSeconds: (Date.parse(b.at) - Date.parse(a.at)) / 1000,
    cpuNonIdlePercent: cpuA !== null && cpuB > cpuA && idleA !== null && idleB !== null ? 100 * (1 - (idleB - idleA) / (cpuB - cpuA)) : null,
    databaseBytesAllDatabases: total(b, 'pg_database_size_bytes'),
    databaseBytesPostgres: total(b, 'pg_database_size_bytes', m => m.labels.datname === 'postgres'),
    memoryTotalBytes: total(b, 'node_memory_MemTotal_bytes'),
    memoryAvailableBytes: total(b, 'node_memory_MemAvailable_bytes'),
    connections: total(b, 'pg_stat_database_num_backends'),
    maxConnections: total(b, 'max_connections_connection_count'),
    poolerWaitingClients: total(b, 'pgbouncer_pools_client_waiting_connections'),
    deadlocksDuringWindow: delta('pg_stat_database_deadlocks_total'),
    tempBytesDuringWindow: delta('pg_stat_database_temp_bytes_total'),
    swapPagesInDuringWindow: delta('node_vmstat_pswpin'),
    swapPagesOutDuringWindow: delta('node_vmstat_pswpout'),
    reportMilliseconds: result.reports.map(r => r.milliseconds),
  };
  result.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ directory, summary: result.summary }));
}
main().catch(error => {
  result.error = error.name + ': ' + error.message; save();
  console.error(JSON.stringify({ directory, error: result.error })); process.exitCode = 1;
});
