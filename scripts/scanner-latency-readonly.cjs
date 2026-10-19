// Small read-only sample. Never invokes the scan RPC, auth refresh or ERP.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const { createClient } = require('@supabase/supabase-js');
const { workspaceIds } = require('../src/lib/analytics/data/composition-catalog.json');
const workspace = workspaceIds[0];
if (!workspace) throw new Error('Configured workspace required');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) },
});
const result = { at: new Date().toISOString(), readOnly: true, source: 'local machine to Supabase',
  limitations: 'Reads only. Does not measure authenticated browser scans, writes, audio or server-to-database latency.', samples: [] };

async function main() {
  // Discover availability through schema metadata; do not execute a write RPC.
  const schemaResponse = await fetch(new URL('/rest/v1/', process.env.NEXT_PUBLIC_SUPABASE_URL), {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!schemaResponse.ok) throw new Error(`Schema HTTP ${schemaResponse.status}`);
  const schema = await schemaResponse.json();
  result.atomicScanRpcAvailable = !!schema.paths?.['/rpc/submit_workspace_scan'];
  for (let sample = 1; sample <= 3; sample++) {
    for (const [name, query] of [
      ['active membership (one record)', () => db.from('workspace_members').select('role').eq('workspace_id', workspace).eq('active', true).limit(1)],
      ['latest session metadata (one record, no orders)', () => db.from('scan_sessions').select('status,revision,updated_at').eq('workspace_id', workspace).order('updated_at', { ascending: false }).limit(1)],
    ]) {
      const started = performance.now();
      const { data, error } = await query();
      if (error) throw new Error(`${name}: ${error.code}`);
      result.samples.push({ sample, query: name, milliseconds: Math.round(performance.now() - started), rows: data.length });
    }
  }
  fs.mkdirSync('docs/evidencias', { recursive: true });
  const file = `docs/evidencias/scanner-latencia-${result.at.replace(/\D/g, '').slice(0, 14)}.json`;
  fs.writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ file, ...result }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
