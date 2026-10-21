require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { previousPeriod, percentageChange, kpiSnapshot } = require('../src/lib/analytics/comparison.ts');

const filters = { from: '2026-10-01', to: '2026-10-21', metric: 'revenue', grouping: 'product', mode: 'TINY_LEGACY', basis: 'orders', costBasis: 'purchase', thresholdA: 80, thresholdB: 95, selections: { companies: ['co'], connections: ['c'], sources: ['s'], statuses: ['1', '6'], skus: ['001'] } };

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

test('snapshot compares the reported aggregates even with incomplete allocation or historical costs', () => {
  const reported = { revenue: '12345', quantity: '2.125', orders: 4, total: 3, top10: 95.5 };
  for (const composition of [undefined, { unallocatedLines: 1 }, { costMissingLines: 1 }, { unallocatedLines: 5, costMissingLines: 3 }]) {
    assert.deepEqual(kpiSnapshot({ ...reported, composition }), reported);
  }
});

test('missing aggregates are not replaced with zeros or used to disable other available metrics', () => {
  const snapshot = kpiSnapshot({ quantity: '12', orders: 0, total: 0, top10: 0 });
  assert.equal(snapshot.revenue, undefined);
  assert.equal(percentageChange(snapshot.revenue, '10').kind, 'unavailable');
  assert.equal(percentageChange(snapshot.quantity, '6').percent, '100.0');
  assert.equal(percentageChange(snapshot.orders, 0).kind, 'zero-base');
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
    return { revenue: '12345', quantity: '2.125', orders: 4, total: 3, top10: 95.5, rows: [{ secret: 'ranking' }], pareto: [{ secret: 'pareto' }], composition: { unallocatedLines: 2, costMissingLines: 3 } };
  });
  const response = await api.POST(request({ filters, workspaceId: 'forged', userId: 'forged', period: { from: '2000-01-01', to: '2000-01-02' } }));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1); assert.equal(calls[0][0], trusted);
  assert.deepEqual(calls[0][1], { ...filters, from: '2026-09-10', to: '2026-09-30' });
  assert.deepEqual(calls[0].slice(2), [0, 0]);
  const data = await response.json();
  assert.deepEqual(data.period, { from: '2026-09-10', to: '2026-09-30' });
  assert.deepEqual(data.previous, { revenue: '12345', quantity: '2.125', orders: 4, total: 3, top10: 95.5 });
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
