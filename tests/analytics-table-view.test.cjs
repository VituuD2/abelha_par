require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { searchTableRows } = require('../src/lib/analytics/table-view.ts');
const row = (rank, name, revenue = '100', quantity = '1') => ({ entityId: String(rank), rank, name, sku: `SKU-${rank}`, revenue, quantity, orders: rank, percent: rank, cumulative: rank, class: 'C' });

test('global table search finds records beyond the first page, ignores accents and preserves source values and ranks', () => {
  const rows = Array.from({ length: 100 }, (_, index) => row(index + 1, index === 97 ? 'Loção Cabelos' : `Produto ${index}`));
  const snapshot = structuredClone(rows);
  const found = searchTableRows(rows, 'locao cabelos', 'rank', 'asc');
  assert.equal(found.length, 1);
  assert.equal(found[0], rows[97]);
  assert.equal(found[0].rank, 98);
  assert.equal(found[0].class, 'C');
  assert.deepEqual(rows, snapshot);
  assert.equal(searchTableRows(rows, 'sku-98', 'rank', 'asc')[0], rows[97]);
  assert.equal(searchTableRows(rows, 'sku-98', 'rank', 'asc', true).length, 0);
  assert.equal(searchTableRows(rows, 'inexistente', 'rank', 'asc').length, 0);
});

test('search sorts the complete matches with exact decimal and cents comparisons and stable server rank ties', () => {
  const rows = [row(4, 'D', '9007199254740993', '-0.1'), row(2, 'B', '9007199254740992', '1.01'), row(3, 'C', '9007199254740992', '1.001'), row(1, 'A', '-100', '10')];
  assert.deepEqual(searchTableRows(rows, '', 'revenue', 'asc').map(r => r.rank), [1, 2, 3, 4]);
  assert.deepEqual(searchTableRows(rows, '', 'quantity', 'asc').map(r => r.rank), [4, 3, 2, 1]);
  assert.deepEqual(searchTableRows(rows, '', 'name', 'desc').map(r => r.rank), [4, 3, 2, 1]);
});
