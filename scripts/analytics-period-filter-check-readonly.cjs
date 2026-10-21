// Reads the exact monthly ABC calculation and quantifies stored gross affected
// by known status changes in a previous ERP audit. No scheduler/worker calls.
require('../tests/setup.cjs'); require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { compositionRulesForWorkspace } = require('../src/lib/analytics/composition-server.ts');
const { summarize } = require('./analytics-period-quality-readonly.cjs');
const directory = process.argv[2];
if (!directory) throw Error('Pass the period audit evidence directory');
const input = JSON.parse(fs.readFileSync(path.join(directory, 'quality.json'), 'utf8'));
const workspace = require('../src/lib/analytics/data/composition-catalog.json').workspaceIds[0];
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(15000) }) },
});
const checked = (result, label) => { if (result.error) throw Error(label + ': ' + (result.error.code || 'unavailable')); return result.data; };
const output = { startedAt: new Date().toISOString(), sourceAuditStartedAt: input.startedAt, sourceAuditFinishedAt: input.finishedAt,
  databaseReadOnly: true, dateBasis: 'commercial sale date', statuses: [1, 5, 6], months: [], affectedByStatus: [] };
const save = () => fs.writeFileSync(path.join(directory, 'filter-check.json'), JSON.stringify(output, null, 2) + '\n');
async function main() {
  if (!input.finishedAt) throw Error('Wait for the source audit to finish');
  const actor = checked(await db.from('workspace_members').select('user_id').eq('workspace_id', workspace).eq('active', true).eq('role', 'admin').limit(1), 'member')[0]?.user_id;
  if (!actor) throw Error('Active administrator required');
  const months = [...new Set(input.consolidated.map(p => p.month))];
  for (const month of months) {
    const periods = input.consolidated.filter(p => p.month === month);
    const from = periods[0].from, to = periods.at(-1).to;
    const filters = { from, to, metric: 'revenue', mode: 'TINY_LEGACY', grouping: 'product', thresholdA: 80, thresholdB: 95, basis: 'orders', costBasis: 'purchase', selections: { statuses: ['1', '5', '6'] } };
    const entry = { month, from, to, at: new Date().toISOString() }; output.months.push(entry);
    const args = { p_workspace: workspace, p_actor: actor, p_filters: filters, p_offset: 0, p_limit: 1, p_sort: 'rank', p_direction: 'asc' };
    const raw = await db.rpc('analytics_abc', args);
    entry.product = raw.error ? { error: raw.error.code || 'unavailable' } : { orders: raw.data.orders, grossCents: raw.data.revenue, quantity: raw.data.quantity };
    // Quantity allows inspection of missing cost/rate allocation without claiming
    // that a monetary query could succeed when cost data are missing.
    const base = await db.rpc('analytics_abc_components_v21', { ...args, p_filters: { ...filters, grouping: 'composition', metric: 'quantity' }, p_rules: compositionRulesForWorkspace(workspace) });
    entry.composition = base.error ? { error: base.error.code || 'unavailable' } : {
      orders: base.data.orders, attributedGrossCents: base.data.revenue,
      originalGrossCents: base.data.composition.originalRevenue, unallocatedGrossCents: base.data.composition.unallocatedRevenue,
      unallocatedLines: base.data.composition.unallocatedLines, pendingSkus: base.data.composition.pendingTotal,
      missingCostLines: base.data.composition.costMissingLines, periodCostCents: base.data.composition.periodCostCents,
      costLastSyncedAt: base.data.composition.costSource?.lastSyncedAt,
    };
    save();
  }
  for (const account of input.accounts) {
    for (const p of account.periods) {
      if (!p.summary) continue;
      const eligible = status => [1, 5, 6].includes(status);
      const changed = p.rows.filter(r => r.local && eligible(r.sourceStatus) !== eligible(r.local.status));
      const sums = new Map();
      for (let offset = 0; offset < changed.length; offset += 50) {
        const ids = changed.slice(offset, offset + 50).map(r => r.local.id);
        let position = 0;
        for (;;) {
          const items = checked(await db.from('analytics_items').select('order_id,gross_cents').eq('workspace_id', workspace).in('order_id', ids).order('order_id').order('position').range(position, position + 999), 'affected items');
          for (const item of items) sums.set(item.order_id, (sums.get(item.order_id) || 0n) + BigInt(item.gross_cents));
          if (items.length < 1000) break;
          position += 1000;
        }
      }
      const shouldEnter = changed.filter(r => eligible(r.sourceStatus));
      const shouldLeave = changed.filter(r => !eligible(r.sourceStatus));
      output.affectedByStatus.push({ account: account.name, month: p.month, week: p.week, from: p.from, to: p.to,
        at: new Date().toISOString(), shouldEnter: shouldEnter.length, shouldLeave: shouldLeave.length,
        storedGrossToEnterCents: shouldEnter.reduce((sum, r) => sum + (sums.get(r.local.id) || 0n), 0n).toString(),
        storedGrossToLeaveCents: shouldLeave.reduce((sum, r) => sum + (sums.get(r.local.id) || 0n), 0n).toString(),
        missingEligibleOrders: p.summary.defaultEligibleMissing });
      save();
    }
  }
  output.monthlyAudit = months.map(month => {
    const parts = input.accounts.flatMap(a => a.periods.filter(p => p.month === month));
    const expectedParts = input.consolidated.filter(p => p.month === month).length * input.accounts.length;
    return { month, ...summarize(parts.flatMap(p => p.rows || []), parts.length === expectedParts && parts.every(p => p.summary?.complete && !p.error)) };
  });
  output.finishedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ directory, months: output.months, monthlyAudit: output.monthlyAudit }));
}
main().catch(error => { output.error = error.message; save(); console.error(error.message); process.exitCode = 1; });
