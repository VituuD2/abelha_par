// ERP GETs plus local ID matching. Only the shared quota/telemetry is written.
// Never import sales, refresh OAuth, schedule jobs or change checkpoints.
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
const from = process.argv.find(a => a.startsWith('--from='))?.slice(7) || '2026-10-01';
const to = process.argv.find(a => a.startsWith('--to='))?.slice(5) || '2026-10-20';
if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw Error('Invalid dates');
const directory = 'docs/evidencias/importacao-v24-reconciliacao-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const output = { startedAt: new Date().toISOString(), from, to, importDataReadOnly: true, quotaTelemetryRecorded: true, accounts: [] };
const checked = r => { if (r.error) throw Error('Database ' + r.error.code); return r.data; };
const save = () => fs.writeFileSync(directory + '/reconcile.json', JSON.stringify(output, null, 2) + '\n');
async function main() {
  fs.mkdirSync(directory, { recursive: true });
  const accounts = checked(await db.from('analytics_connections').select('id,name,credential_kind,legacy_integration_id,access_token,expires_at,verified_tax_id').eq('workspace_id', workspace).eq('enabled', true).order('name'));
  await Promise.all(accounts.map(async account => {
    const entry = { name: account.name, connectionId: account.id, pages: [] }; output.accounts.push(entry); save();
    try {
      const stored = account.credential_kind === 'legacy'
        ? checked(await db.from('tiny_integrations').select('access_token,expires_at').eq('workspace_id', workspace).eq('id', account.legacy_integration_id).single()) : account;
      if (!stored.access_token || !(Date.parse(stored.expires_at || '') > Date.now())) throw Error('Token expired; no refresh performed');
      const token = decryptToken(stored.access_token); let previous = 0;
      async function get(path) {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, previous + 5000 - Date.now()))); previous = Date.now();
        return olistRequest(token, account.id, path, { deadlineMs: Date.now() + 25000 });
      }
      if (String((await get('/info')).cpfCnpj).replace(/\D/g, '') !== account.verified_tax_id) throw Error('Identity mismatch');
      const source = new Map(); let initialTotal;
      for (let offset = 0; offset < 10000; offset += 100) {
        const body = await get('/pedidos?' + new URLSearchParams({ dataInicial: from, dataFinal: to, limit: '100', offset: String(offset), orderBy: 'asc' }));
        const total = Number(body.paginacao?.total);
        if (!Array.isArray(body.itens) || !Number.isSafeInteger(total) || total < 0) throw Error('Invalid pagination');
        initialTotal ??= total; entry.pages.push({ offset, count: body.itens.length, total, at: new Date().toISOString() });
        for (const row of body.itens) source.set(String(row.id), { id: String(row.id), status: Number(row.situacao) });
        save(); if (offset + body.itens.length >= total) break;
        if (!body.itens.length) throw Error('Empty incomplete source page');
      }
      entry.complete = source.size === initialTotal && entry.pages.every(p => p.total === initialTotal);
      const local = new Map(), ids = [...source.keys()];
      for (let offset = 0; offset < ids.length; offset += 100) {
        const rows = checked(await db.from('analytics_orders').select('external_id,status').eq('workspace_id', workspace).eq('connection_id', account.id).in('external_id', ids.slice(offset, offset + 100)));
        for (const row of rows) local.set(String(row.external_id), row.status);
      }
      const active = [...source.values()].filter(row => row.status !== 2);
      entry.sourceTotal = source.size; entry.sourceNonCancelled = active.length;
      entry.matchedNonCancelled = active.filter(row => local.has(row.id)).length;
      entry.missingNonCancelled = active.filter(row => !local.has(row.id)).length;
      entry.statusMismatches = [...source.values()].filter(row => local.has(row.id) && local.get(row.id) !== row.status).length;
      entry.missingCancelled = [...source.values()].filter(row => row.status === 2 && !local.has(row.id)).length;
    } catch (error) { entry.error = error.message; }
    entry.finishedAt = new Date().toISOString(); save();
    const { pages, ...summary } = entry; console.log(JSON.stringify({ directory, ...summary, sourcePages: pages.length }));
  }));
}
main().catch(error => { output.error = error.message; process.exitCode = 1; }).finally(() => {
  fs.mkdirSync(directory, { recursive: true }); output.finishedAt = new Date().toISOString(); save(); console.log(JSON.stringify({ directory }));
});
