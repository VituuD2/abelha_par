// Read-only sample of blocked orders. No refresh, ingest, or scheduling.
require('../tests/setup.cjs');
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const { decryptToken } = require('../src/lib/token-crypto.ts');
const { normalizeOrder } = require('../src/lib/analytics/normalize.ts');
const fs = require('node:fs');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const wait = () => new Promise(r => setTimeout(r, 2100));
async function main() {
  const out = { at: new Date().toISOString(), mode: 'GET only; credentials never emitted', connections: [] };
  const { data: connections, error } = await db.from('analytics_connections').select('id,workspace_id,name,credential_kind,legacy_integration_id,access_token,expires_at,verified_tax_id');
  if (error) throw new Error('Connections unavailable');
  for (const c of connections) {
    const entry = { name: c.name, blocked: [] };
    out.connections.push(entry);
    let stored = c;
    if (c.credential_kind === 'legacy') stored = (await db.from('tiny_integrations').select('access_token,expires_at').eq('id', c.legacy_integration_id).single()).data;
    if (!stored?.access_token || Date.parse(stored.expires_at || '') < Date.now()) { entry.source = 'token expired/missing; no refresh attempted'; continue; }
    const token = decryptToken(stored.access_token);
    async function get(path) {
      await wait();
      const start = performance.now();
      try {
        const r = await fetch('https://api.tiny.com.br/public-api/v3' + path, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000) });
        return { status: r.status, ms: Math.round(performance.now() - start), data: r.ok ? await r.json() : null };
      } catch { return { status: 'timeout/network', ms: Math.round(performance.now() - start) }; }
    }
    const info = await get('/info');
    entry.info = { status: info.status, ms: info.ms, identityMatches: info.data ? String(info.data.cpfCnpj).replace(/\D/g, '') === c.verified_tax_id : null };
    const { data: jobs } = await db.from('analytics_sync_jobs').select('pending_ids,pending_index,last_error,cursor_date').eq('connection_id', c.id).neq('status', 'completed');
    for (const j of jobs || []) {
      const pending = j.pending_ids[j.pending_index];
      if (!/^\d+$/.test(String(pending))) { entry.blocked.push({ cursor: j.cursor_date, error: 'invalid pending ID', lastError: j.last_error }); continue; }
      const r = await get('/pedidos/' + pending);
      const b = r.data;
      const meta = { cursor: j.cursor_date, status: r.status, ms: r.ms, lastError: j.last_error };
      entry.blocked.push(meta);
      if (!b) continue;
      meta.idMatches = String(b.id) === String(pending);
      meta.orderStatus = b.situacao;
      meta.itemCount = b.itens?.length;
      meta.productIds = (b.itens || []).map(i => ({ idType: typeof i.produto?.id, idValid: /^\d+$/.test(String(i.produto?.id)) && BigInt(i.produto.id) > 0n, idZero: i.produto?.id === 0 || i.produto?.id === '0', hasSku: !!i.produto?.sku, hasDescription: !!i.produto?.descricao }));
      meta.hasInvoice = !!b.idNotaFiscal;
      try { normalizeOrder(b, c.id, c.id, new Date().toISOString()); meta.normalize = 'passed'; }
      catch (e) { meta.normalize = e.message; }
    }
  }
  fs.mkdirSync('docs/evidencias/curva-abc-2026-10-16', { recursive: true });
  fs.writeFileSync('docs/evidencias/curva-abc-2026-10-16/fonte-bloqueios.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch(() => { console.error('Read-only source audit failed; no secrets printed.'); process.exitCode = 1; });
