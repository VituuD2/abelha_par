// Import/credential data is read-only. Optional ERP GETs use the existing quota
// controller and record quota telemetry; never refresh OAuth, claim or schedule jobs.
require('../tests/setup.cjs');
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');
const { decryptToken } = require('../src/lib/token-crypto.ts');
const { olistRequest } = require('../src/lib/analytics/olist-client.ts');
const workspace = require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) },
});
const directory = 'docs/evidencias/importacao-v24-estimativa-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const only = process.argv.find(value => value.startsWith('--connection='))?.slice(13);
const output = { startedAt: new Date().toISOString(), importDataReadOnly: true, providerGets: process.argv.includes('--source'), quotaTelemetryRecorded: process.argv.includes('--source'), today, accounts: [] };
const checked = (result, label) => { if (result.error) throw Error(label + ': ' + result.error.code); return result.data; };
const addDay = (day, n = 1) => new Date(Date.parse(day + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const save = () => fs.writeFileSync(directory + '/status.json', JSON.stringify(output, null, 2) + '\n');
async function main() {
  fs.mkdirSync(directory, { recursive: true });
  const [connectionsResult, jobsResult, memberResult, cronResult] = await Promise.all([
    db.from('analytics_connections').select('id,name,enabled,verified_at,last_synced_at,last_processed_at,last_error,error_code,incremental_through').eq('workspace_id', workspace).order('name'),
    db.from('analytics_sync_jobs').select('id,connection_id,lane,mode,status,from_date,to_date,cursor_date,query_phase,page_offset,page_done,pending_index,processed,pages,attempts,next_at,created_at,updated_at,last_claimed_at,lease_until,error_code,last_error,covers_sales,scan:import_state->scan').eq('workspace_id', workspace).order('created_at').limit(1000),
    db.from('workspace_members').select('user_id').eq('workspace_id', workspace).eq('active', true).eq('role', 'admin').limit(1),
    db.from('analytics_cron_runs').select('requested_at').order('requested_at', { ascending: false }).limit(120),
  ]);
  const connections = checked(connectionsResult, 'connections'), jobs = checked(jobsResult, 'jobs');
  const actor = checked(memberResult, 'member')[0]?.user_id;
  if (!actor) throw Error('Active administrator required');
  output.snapshotAt = new Date().toISOString();
  output.cron = checked(cronResult, 'cron');
  output.coverage = checked(await db.rpc('analytics_coverage', { p_workspace: workspace, p_actor: actor }, { get: true }), 'coverage');
  const usage = checked(await db.rpc('olist_api_usage', { p_workspace: workspace, p_actor: actor, p_minutes: 60 }, { get: true }), 'usage');
  for (const c of connections) {
    const count = await db.from('analytics_orders').select('*', { head: true, count: 'exact' }).eq('workspace_id', workspace).eq('connection_id', c.id);
    checked(count, 'order count');
    const accountUsage = usage.accounts?.find(a => a.connection_id === c.id);
    const totals = rows => rows.reduce((sum, row) => {
      for (const key of ['requests', 'responses', 'throttled', 'server_errors', 'timeouts', 'network_errors', 'retries', 'duration_ms']) sum[key] = (sum[key] || 0) + Number(row[key] || 0);
      return sum;
    }, {});
    const entry = { ...c, orders: count.count, jobs: jobs.filter(j => j.connection_id === c.id), sourceQueries: [],
      usage: accountUsage && { plan: accountUsage.plan, limit: accountUsage.effective_limit, providerRemaining: accountUsage.provider_remaining,
        observedAt: accountUsage.observed_at, totals: totals(accountUsage.minutes),
        bySource: Object.fromEntries(['orders', 'costs', 'identity', 'operational'].map(source => [source, totals(accountUsage.minutes.filter(m => m.source === source))])) } };
    output.accounts.push(entry); save();
  }
  if (!output.providerGets) return;
  await Promise.all(output.accounts.filter(c => c.enabled && (!only || c.id === only)).map(async entry => {
    try {
      const c = checked(await db.from('analytics_connections').select('credential_kind,legacy_integration_id,access_token,expires_at,verified_tax_id').eq('workspace_id', workspace).eq('id', entry.id).single(), 'credential');
      const stored = c.credential_kind === 'legacy'
        ? checked(await db.from('tiny_integrations').select('access_token,expires_at').eq('workspace_id', workspace).eq('id', c.legacy_integration_id).single(), 'operational credential') : c;
      if (!stored.access_token || !(Date.parse(stored.expires_at || '') > Date.now())) throw Error('Stored token expired; no refresh performed');
      if (!c.verified_tax_id) throw Error('Verified account identity required');
      const token = decryptToken(stored.access_token);
      let lastRequest = 0;
      async function get(path) {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, lastRequest + 5000 - Date.now())));
        lastRequest = Date.now();
        return olistRequest(token, entry.id, path, { deadlineMs: Date.now() + 25000, source: 'orders' });
      }
      const info = await get('/info');
      if (String(info.cpfCnpj).replace(/\D/g, '') !== c.verified_tax_id) throw Error('Account identity mismatch');
      entry.identityConfirmed = true;
      async function count(kind, from, to, since) {
        const params = { limit: '1', offset: '0', orderBy: 'asc', dataInicial: from, dataFinal: to, ...(since ? { dataAtualizacao: since } : {}) };
        let body;
        try { body = await get('/pedidos?' + new URLSearchParams(params)); }
        catch (error) {
          if (error.kind !== 'timeout' || addDay(from, 6) >= to) throw error;
          entry.partitionFallbacks = (entry.partitionFallbacks || 0) + 1;
          let total = 0;
          for (let day = from; day <= to;) {
            const end = addDay(day, 6) < to ? addDay(day, 6) : to;
            total += await count(kind, day, end, since); day = addDay(end);
          }
          return total;
        }
        const total = Number(body.paginacao?.total);
        if (!Number.isSafeInteger(total) || total < 0) throw Error('Missing source total');
        const result = { kind, from, to, ...(since ? { since } : {}), total, at: new Date().toISOString() };
        entry.sourceQueries.push(result); save(); return total;
      }
      // Reconcile today's creations by immutable ERP IDs, not local commercial dates.
      const recentSource = new Map(); let sourceTotal;
      for (let offset = 0; offset < 500; offset += 100) {
        const body = await get('/pedidos?' + new URLSearchParams({ dataInicial: today, dataFinal: today, limit: '100', offset: String(offset), orderBy: 'desc' }));
        const total = Number(body.paginacao?.total);
        if (!Array.isArray(body.itens) || !Number.isSafeInteger(total)) throw Error('Invalid recent pagination');
        if (sourceTotal !== undefined && sourceTotal !== total) entry.recentSourceChanged = true;
        sourceTotal ??= total;
        for (const row of body.itens) recentSource.set(String(row.id), { id: String(row.id), status: Number(row.situacao) });
        if (offset + body.itens.length >= total || !body.itens.length) break;
      }
      const local = new Map(), ids = [...recentSource.keys()];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const rows = checked(await db.from('analytics_orders').select('external_id,status,fetched_at').eq('workspace_id', workspace).eq('connection_id', entry.id).in('external_id', ids.slice(offset, offset + 100)), 'recent match');
        for (const row of rows) local.set(row.external_id, row);
      }
      const active = [...recentSource.values()].filter(row => row.status !== 2);
      entry.recent = { at: new Date().toISOString(), creationDate: today, sourceTotal, sourceUnique: recentSource.size,
        complete: !entry.recentSourceChanged && recentSource.size === sourceTotal, nonCancelled: active.length,
        matchedNonCancelled: active.filter(row => local.has(row.id)).length,
        missingNonCancelled: active.filter(row => !local.has(row.id)).length,
        statusMismatches: [...recentSource.values()].filter(row => local.has(row.id) && local.get(row.id).status !== row.status).length };
      save();
      if (process.argv.includes('--recent-only')) return;
      const job = entry.jobs.find(j => j.lane === 'history' && j.mode === 'incremental' && j.status !== 'completed');
      if (!job?.scan || job.scan.version !== 2) throw Error('A v24 partitioned active job is required for estimating remaining work');
      if (job.query_phase === 'sales') {
        const total = await count('remaining-sales', job.cursor_date, job.to_date);
        entry.remainingSales = Math.max(0, total - job.page_offset - job.pending_index);
      } else entry.remainingSales = 0;
      // Disjoint creation windows: count each update once instead of repeating it per day.
      let updates = 0;
      for (let from = job.scan.from; from <= job.scan.ceiling;) {
        const monthEnd = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0, 12)).toISOString().slice(0, 10);
        const to = monthEnd < job.scan.ceiling ? monthEnd : job.scan.ceiling;
        updates += await count('remaining-updates', from, to, job.scan.since); from = addDay(to);
      }
      entry.remainingUpdates = Math.max(0, updates - (job.query_phase === 'updates' ? job.page_offset + job.pending_index : 0));
      entry.remainingHistoryEvents = entry.remainingSales + entry.remainingUpdates;
      if (job.to_date < today) {
        entry.nextCycleSales = await count('next-cycle-sales', addDay(job.to_date, -1), today);
        entry.nextCycleUpdates = await count('next-cycle-updates', job.scan.floor, today, addDay(job.to_date, -1));
      }
    } catch (error) {
      entry.sourceError = error?.name === 'TimeoutError' ? 'Source timeout' : error.message;
    }
    save();
    console.log(JSON.stringify({ directory, name: entry.name, recent: entry.recent, remainingHistoryEvents: entry.remainingHistoryEvents, sourceError: entry.sourceError }));
  }));
}
main().catch(error => { output.error = error.message; process.exitCode = 1; }).finally(() => {
  fs.mkdirSync(directory, { recursive: true }); output.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ directory, at: output.snapshotAt, accounts: output.accounts.map(c => ({ name: c.name, orders: c.orders, lastError: c.last_error, active: c.jobs.filter(j => j.status !== 'completed').map(j => ({ lane: j.lane, phase: j.query_phase, cursor: j.cursor_date, processed: j.processed, error: j.last_error })) })) }));
});
