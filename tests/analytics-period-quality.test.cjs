const { test } = require('node:test');
const assert = require('node:assert/strict');
const { periods, percent, summarize, line } = require('../scripts/analytics-period-quality-readonly.cjs');

test('four monthly bands include days 29–31 and clip configured/current scope', () => {
  const p = periods('2026-07-23', '2026-10-21');
  assert.equal(p.length, 16);
  assert.deepEqual(p.filter(w => w.included).map(w => [w.from, w.to]).slice(0, 2), [['2026-07-23', '2026-07-31'], ['2026-08-01', '2026-08-07']]);
  assert.equal(p.filter(w => w.included).at(-1).to, '2026-10-21');
  assert.equal(p.find(w => w.month === '2026-08' && w.week === 4).to, '2026-08-31');
  assert.throws(() => periods('2026-02-30', '2026-10-21'));
});
test('unknown/empty/incomplete periods cannot claim 100 percent', () => {
  assert.equal(percent(0, 0, true), null);
  assert.equal(percent(10, 10, false), null);
  assert.equal(percent(99999, 100000, true), 99.99);
  assert.equal(percent(3, 3, true), 100);
});
test('100 percent presence still exposes changed status/value and cancelled sales included locally', () => {
  const row = (id, sourceStatus, localStatus, total = '100') => ({ id, sourceStatus, sourceTotalCents: '100', local: { status: localStatus, total_cents: total } });
  const result = summarize([row('1', 1, 1), row('2', 5, 1), row('3', 6, 6, '90'), row('4', 2, 1)], true);
  assert.equal(result.presencePercent, 100);
  assert.equal(result.consistentActive, 1);
  assert.equal(result.consistencyPercent, 33.33);
  assert.equal(result.statusDifferences, 2);
  assert.equal(result.cancelledStillActive, 1);
  assert.equal(result.defaultEligibilityDifferences, 1);
  assert.equal(result.totalDifferences, 1);
});
test('missing eligible orders and unknown monetary totals stay pending', () => {
  const result = summarize([{ id: '1', sourceStatus: 1, sourceTotalCents: '100' }, { id: '2', sourceStatus: 6, sourceTotalCents: null, local: { status: 6, total_cents: '100' } }], true);
  assert.equal(result.presencePercent, 50);
  assert.equal(result.missingActive, 1);
  assert.equal(result.defaultEligibleMissing, 1);
  assert.equal(result.consistencyPercent, 0);
  assert.equal(result.sourceOrderTotalCents, null);
});
test('sample monetary arithmetic keeps signed lines and fractional quantities exact', () => {
  assert.equal(line('12.345', '2'), 2469n);
  assert.equal(line('-0.005', '1'), -1n);
  assert.equal(line('0.10', '0.25'), 3n);
});
test('monthly percentage weights orders instead of averaging weekly percentages', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ id: String(index), sourceStatus: 1, sourceTotalCents: '100',
    ...(index < 6 ? { local: { status: 1, total_cents: '100' } } : {}) }));
  assert.equal(summarize(rows.slice(0, 1), true).presencePercent, 100);
  assert.equal(summarize(rows.slice(1), true).presencePercent, 55.56);
  assert.equal(summarize(rows, true).presencePercent, 60);
});
