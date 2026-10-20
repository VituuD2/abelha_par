// GET-only diagnosis of one account's pending orders; no worker, writes or OAuth refresh.
require('../tests/setup.cjs');
require('dotenv').config({quiet: true});
const fs = require('node:fs');
const {createClient} = require('@supabase/supabase-js');
const {decryptToken} = require('../src/lib/token-crypto.ts');
const {normalizeOrder} = require('../src/lib/analytics/normalize.ts');
const workspace = require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const connectionId = process.argv.find(a => a.startsWith('--connection='))?.split('=')[1];
const directory = `docs/evidencias/importacao-pendencias-${new Date().toISOString().replace(/\D/g, '').slice(0,14)}`;
const out = {at: new Date().toISOString(), readOnly: true, orders: []};
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {persistSession: false, autoRefreshToken: false},
  global: {fetch: (url, options) => fetch(url, {...options, signal: AbortSignal.timeout(10000)})},
});
const checked = r => { if (r.error) throw Error(`Database ${r.status}/${r.error.code}`); return r.data; };
async function main() {
  if (!connectionId) throw Error('Use --connection=UUID');
  const c = checked(await db.from('analytics_connections')
    .select('id,name,company_id,credential_kind,legacy_integration_id,access_token,expires_at')
    .eq('workspace_id', workspace).eq('id', connectionId).eq('enabled', true).single());
  const company = checked(await db.from('analytics_companies').select('tax_id')
    .eq('workspace_id', workspace).eq('id', c.company_id).single());
  const stored = c.credential_kind === 'legacy' ? checked(await db.from('tiny_integrations')
    .select('access_token,expires_at').eq('workspace_id', workspace).eq('id', c.legacy_integration_id).single()) : c;
  if (!stored.access_token || !(Date.parse(stored.expires_at || '') > Date.now())) throw Error('Stored token expired; no refresh attempted.');
  const token = decryptToken(stored.access_token);
  let previous = 0;
  async function get(path) {
    await new Promise(r => setTimeout(r, Math.max(0, previous + 3000 - Date.now())));
    previous = Date.now();
    const response = await fetch('https://api.tiny.com.br/public-api/v3' + path, {
      headers: {Authorization: 'Bearer ' + token}, signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error(`Olist HTTP ${response.status}`);
    return response.json();
  }
  if (String((await get('/info')).cpfCnpj).replace(/\D/g, '') !== company.tax_id) throw Error('ERP identity mismatch');
  const jobs = checked(await db.from('analytics_sync_jobs')
    .select('id,mode,cursor_date,pending_ids,pending_index,processed,updated_at,status')
    .eq('workspace_id', workspace).eq('connection_id', c.id).in('status', ['queued','running','retry']).order('created_at').limit(3));
  out.connection = c.name;
  for (const job of jobs) {
    const pending = String(job.pending_ids[job.pending_index] || '');
    if (!/^\d+$/.test(pending)) continue;
    const start = Date.now(), raw = await get('/pedidos/' + pending);
    if (String(raw.id) !== pending) throw Error('ERP returned another order');
    const productIds = [...new Set((raw.itens || []).map(i => String(i.produto?.id || '')).filter(id => /^[1-9]\d*$/.test(id)))];
    const cacheStart = Date.now();
    const cached = productIds.length ? checked(await db.from('analytics_products').select('external_id,enriched_at,enrichment_checked_at')
      .eq('workspace_id', workspace).eq('connection_id', c.id).in('external_id', productIds.slice(0, 500))) : [];
    let normalization;
    try { normalizeOrder(raw, c.id, c.id, new Date().toISOString()); normalization = {ok: true}; }
    catch (e) { normalization = {ok: false, error: e.message}; }
    out.orders.push({jobId: job.id, mode: job.mode, status: job.status, cursor: job.cursor_date,
      pendingIndex: job.pending_index, processed: job.processed, checkpointUpdatedAt: job.updated_at,
      orderId: pending, detailAndPacingMs: cacheStart - start, items: raw.itens?.length,
      distinctProducts: productIds.length, productsChecked: Math.min(productIds.length, 500),
      cachedProducts: cached.length, freshProducts: cached.filter(p => Math.max(Date.parse(p.enriched_at || '') || 0,
        Date.parse(p.enrichment_checked_at || '') || 0) > Date.now() - 7*86400000).length,
      batchedCacheReadMs: Date.now() - cacheStart, hasInvoice: !!raw.idNotaFiscal && String(raw.idNotaFiscal) !== '0', normalization});
  }
}
main().catch(e => {out.error = e.message; process.exitCode = 1;}).finally(() => {
  fs.mkdirSync(directory, {recursive: true});
  fs.writeFileSync(directory + '/status.json', JSON.stringify(out, null, 2) + '\n');
  console.log(JSON.stringify({directory, ...out}));
});
