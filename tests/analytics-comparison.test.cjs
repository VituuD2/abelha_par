require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { previousPeriod, percentageChange, comparisonBlocker, kpiSnapshot } = require('../src/lib/analytics/comparison.ts');

const filters = { from: '2026-10-01', to: '2026-10-21', metric: 'revenue', grouping: 'product', mode: 'TINY_LEGACY', basis: 'orders', costBasis: 'purchase', thresholdA: 80, thresholdB: 95, selections: { companies: ['co'], connections: ['c'], sources: ['s'], statuses: ['1', '6'], skus: ['001'] } };
const status = () => ({ companies: [{ id: 'co', name: 'Selecionada' }], connections: [{ id: 'c', company_id: 'co', name: 'Olist', enabled: true, verified_at: '2026-01-01' }], sources: [{ id: 's', connection_id: 'c' }], jobs: [], coverage: [{ connection_id: 'c', mode: 'backfill', status: 'completed', from_date: '2026-09-01', to_date: '2026-10-21' }] });

test('previous period uses the same inclusive duration across months, leap years, year changes and daylight saving', () => {
  for (const [from, to, expected] of [
    ['2026-10-01', '2026-10-21', { from: '2026-09-10', to: '2026-09-30' }],
    ['2024-03-01', '2024-03-01', { from: '2024-02-29', to: '2024-02-29' }],
    ['2024-02-01', '2024-02-29', { from: '2024-01-03', to: '2024-01-31' }],
    ['2026-01-01', '2026-01-31', { from: '2025-12-01', to: '2025-12-31' }],
    ['2018-11-03', '2018-11-05', { from: '2018-10-31', to: '2018-11-02' }],
  ]) {
    const actual = previousPeriod({ from, to });
    assert.deepEqual(actual, expected);
    assert.equal(Date.parse(to) - Date.parse(from), Date.parse(actual.to) - Date.parse(actual.from));
    assert.equal(Date.parse(from) - Date.parse(actual.to), 86400000);
  }
  assert.throws(() => previousPeriod({ from: '0000-01-01', to: '0000-01-01' }), /intervalo de datas/);
});

test('variations use the actual formula, decimal precision and correct rounding without unsafe money conversion', () => {
  for (const [current, previous, percent, direction] of [
    ['12500', '10000', '25.0', 'up'], ['7500', '10000', '-25.0', 'down'],
    ['2.125', '1.7', '25.0', 'up'], [1, 3, '-66.7', 'down'], [0, 100, '-100.0', 'down'],
    [10, 10, '0.0', 'flat'], ['0.0000002', '0.0000001', '100.0', 'up'], [1e-8, 2e-8, '-50.0', 'down'],
    ['1125899906842624250', '900719925474099400', '25.0', 'up'],
  ]) {
    const change = percentageChange(current, previous);
    assert.equal(change.kind, 'change'); assert.equal(change.percent, percent); assert.equal(change.direction, direction);
  }
  const tiny = percentageChange('900719925474099401', '900719925474099400');
  assert.equal(tiny.tiny, true); assert.equal(tiny.direction, 'up');
  assert.equal(percentageChange('-50', '-100').negativeBase, true);
  assert.equal(percentageChange('-50', '-100').direction, 'up');
  assert.equal(percentageChange('-50', '-100').percent, '-50.0');
  assert.equal(percentageChange('-150', '-100').direction, 'down');
  assert.equal(percentageChange('-150', '-100').percent, '50.0');
  for (const value of [0, 1, -1]) assert.equal(percentageChange(value, 0).kind, 'zero-base');
  for (const value of ['bad', NaN, Infinity, undefined]) assert.equal(percentageChange(value, 10).kind, 'unavailable');
});

test('coverage checks both periods and only selected companies/connections/sources without scheduling anything', () => {
  assert.match(comparisonBlocker(null, filters), /Verificando/);
  const full = status(); assert.equal(comparisonBlocker(full, filters), null);
  const previousGap = status(); previousGap.coverage[0].from_date = filters.from;
  assert.match(comparisonBlocker(previousGap, filters), /anterior parcial/);
  const currentGap = status(); currentGap.coverage[0].to_date = '2026-10-20';
  assert.match(comparisonBlocker(currentGap, filters), /atual parcial/);
  for (const jobStatus of ['queued', 'running', 'retry', 'failed']) {
    const pending = status(); pending.jobs.push({ connection_id: 'c', from_date: '2026-09-10', to_date: '2026-09-30', status: jobStatus });
    assert.match(comparisonBlocker(pending, filters), /pendente|parcial/);
  }
  const other = status(); other.jobs.push({ connection_id: 'foreign', from_date: '2026-09-01', to_date: '2026-10-21', status: 'running' });
  other.connections.push({ id: 'foreign', company_id: 'other', last_error: 'Erro', enabled: false });
  assert.equal(comparisonBlocker(other, filters), null);
  other.jobs.push({ connection_id: 'c', from_date: '2025-01-01', to_date: '2025-01-02', status: 'running' });
  assert.equal(comparisonBlocker(other, filters), null);
});

test('composition comparison treats pending or incomplete costs as unavailable, while completed costs allow comparison', () => {
  for (const costSync of [{ connection_id: 'c' }, { last_error: 'Falha' }, { last_synced_at: '2026-10-21', page_offset: 100 }, { history: { pending: 2 } }]) {
    assert.match(comparisonBlocker({ ...status(), costSync }, { ...filters, grouping: 'composition' }), /CMV/);
    assert.equal(comparisonBlocker({ ...status(), costSync }, filters), null);
  }
  assert.equal(comparisonBlocker({ ...status(), costSync: { connection_id: 'c', last_synced_at: '2026-10-21', history: { pending: 0 } } }, { ...filters, grouping: 'composition' }), null);
  assert.equal(kpiSnapshot({ composition: { unallocatedLines: 1 } }).costIncomplete, true);
  assert.equal(kpiSnapshot({ composition: { costMissingLines: 1 } }).costIncomplete, true);
  assert.equal(kpiSnapshot({}).costIncomplete, false);
});

const access = require('../src/lib/access.ts');
const server = require('../src/lib/analytics/server.ts');
const api = require('../src/app/api/analytics/comparison/route.ts');
const request = body => new Request('http://localhost/api/analytics/comparison', { method: 'POST', body: JSON.stringify(body) });

test('comparison API derives dates on the server, preserves all applied filters and returns only authorized KPI aggregates', async t => {
  const calls = [];
  const trusted = { workspaceId: 'trusted', user: { id: 'user' }, role: 'operator' };
  t.mock.method(access, 'authorize', async permission => { assert.equal(permission, 'analytics:read'); return { access: trusted }; });
  t.mock.method(server, 'report', async (...args) => {
    calls.push(args);
    return { revenue: '12345', quantity: '2.125', orders: 4, total: 3, top10: 95.5, rows: [{ secret: 'ranking' }], pareto: [{ secret: 'pareto' }], composition: { unallocatedLines: 0 } };
  });
  const response = await api.POST(request({ filters, workspaceId: 'forged', userId: 'forged', period: { from: '2000-01-01', to: '2000-01-02' } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], trusted);
  assert.deepEqual(calls[0][1], { ...filters, from: '2026-09-10', to: '2026-09-30' });
  assert.deepEqual(calls[0].slice(2), [0, 0]);
  const data = await response.json();
  assert.deepEqual(data.period, { from: '2026-09-10', to: '2026-09-30' });
  assert.deepEqual(data.previous, { revenue: '12345', quantity: '2.125', orders: 4, total: 3, top10: 95.5, costIncomplete: false });
  assert.equal(data.rows, undefined); assert.equal(data.pareto, undefined);
});

test('comparison API rejects unauthorized and invalid requests before querying; errors do not turn into zero baselines', async t => {
  let reads = 0;
  t.mock.method(server, 'report', async () => { reads++; throw new Error('CMV histórico indisponível'); });
  t.mock.method(access, 'authorize', async () => ({ response: Response.json({ error: 'Negado' }, { status: 403 }) }));
  assert.equal((await api.POST(request({ filters }))).status, 403); assert.equal(reads, 0);
  t.mock.method(access, 'authorize', async () => ({ access: { workspaceId: 'trusted', user: { id: 'user' } } }));
  assert.equal((await api.POST(request({ filters: { ...filters, from: 'invalid' } }))).status, 400); assert.equal(reads, 0);
  const failure = await api.POST(request({ filters }));
  assert.equal(failure.status, 400); assert.match((await failure.json()).error, /CMV histórico/); assert.equal(reads, 1);
});
