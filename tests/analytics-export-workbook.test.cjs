require('./setup.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Workbook } = require('exceljs');
const XLSX = require('xlsx');
const { createABCWorkbook } = require('../src/lib/analytics/export-workbook.ts');
const { EXPORT_COLUMNS, exportMetadata, exportRow } = require('../src/lib/analytics/export.ts');

const filters = { from: '2026-10-01', to: '2026-10-21', metric: 'revenue', grouping: 'product', mode: 'TINY_LEGACY', basis: 'orders', thresholdA: 80, thresholdB: 95, selections: {} };
const rows = ['A', 'B', 'C'].map((cls, index) => ({
  rank: index + 1, name: ['=SUM(1,2)', 'Produto B com descrição extensa '.repeat(4), 'Produto C'][index],
  sku: ['000001', '+FORMULA', '@FORMULA'][index], entityId: `id-${index}`, class: cls,
  revenue: ['8000', '1500', '500'][index], quantity: ['2.125', '3', '0.000001'][index], orders: 1,
  percent: [80, 15, 5][index], cumulativeBefore: [0, 80, 95][index], cumulative: [80, 95, 100][index],
}));
const result = { rows, total: 3, revenue: '10000', quantity: '5.125001', orders: 2, top10: 100, generatedAt: '2026-10-21T15:30:00Z', pareto: rows,
  classes: Object.fromEntries(rows.map(row => [row.class, { count: 1, revenue: row.revenue, quantity: row.quantity, percent: row.percent }])) };
const metadata = f => [...exportMetadata(f, result), ['Cobertura no período', 'Parcial ou não confirmada'], ['Confiabilidade', 'Análise provisória']];
async function roundtrip(f = filters, r = result, columns = EXPORT_COLUMNS) {
  const source = createABCWorkbook(f, r, metadata(f), columns);
  const buffer = await source.xlsx.writeBuffer();
  const book = new Workbook();
  await book.xlsx.load(buffer);
  return { book, buffer };
}

test('XLSX roundtrip preserves all ranking data, numeric formats, class backgrounds and Excel navigation', async () => {
  const { book, buffer } = await roundtrip();
  assert.deepEqual(book.worksheets.map(ws => ws.name), ['Resumo', 'Curva ABC', 'Escopo']);
  const ws = book.getWorksheet('Curva ABC');
  assert.equal(ws.rowCount, 4);
  assert.equal(ws.getCell('A1').font.bold, true);
  assert.equal(ws.getCell('A1').font.color.argb, 'FFFFFFFF');
  assert.equal(ws.getCell('A1').alignment.wrapText, true);
  assert.equal(ws.getRow(1).height, 40);
  assert.equal(ws.autoFilter, 'A1:K4');
  assert.equal(ws.views[0].state, 'frozen');
  assert.equal(ws.views[0].xSplit, 3);
  assert.equal(ws.views[0].ySplit, 1);
  assert.equal(ws.views[0].showGridLines, false);
  assert.equal(ws.getColumn(11).hidden, true);
  assert.equal(ws.getColumn(2).width, 64);
  assert.ok(ws.getRow(3).height > ws.getRow(2).height);
  assert.equal(ws.getCell('D2').value, 80);
  assert.match(ws.getCell('D2').numFmt, /R\$/);
  assert.equal(ws.getCell('E2').value, 2.125);
  assert.equal(ws.getCell('E4').value, 0.000001);
  assert.equal(ws.getCell('E3').numFmt, '#,##0');
  assert.equal(ws.getCell('G2').value, 0.8);
  assert.equal(ws.getCell('I4').value, 1);
  assert.equal(ws.getCell('G2').numFmt, '0.00%');
  const summary = book.getWorksheet('Resumo');
  for (const [index, cls] of ['A', 'B', 'C'].entries()) {
    assert.equal(ws.getCell(`J${index + 2}`).value, cls);
    assert.equal(ws.getCell(`J${index + 2}`).fill.fgColor.argb, summary.getCell(`A${index + 13}`).fill.fgColor.argb);
    assert.equal(ws.getCell(`D${index + 2}`).fill.fgColor.argb, summary.getCell(`B${index + 13}`).fill.fgColor.argb);
  }
  assert.equal(new Set([2, 3, 4].map(r => ws.getCell(`J${r}`).fill.fgColor.argb)).size, 3);
  assert.equal(summary.getCell('A7').value, 100);
  assert.equal(summary.getCell('D7').value, 5.125001);
  assert.equal(summary.getCell('D10').value, 1);
  assert.match(summary.getCell('A4').value, /21\/10\/2026.*12:30/);
  assert.match(summary.getCell('A24').value, /Parcial.*provisória/);
  const scope = book.getWorksheet('Escopo');
  assert.equal(scope.rowCount, metadata(filters).length + 1);
  assert.equal(scope.getCell('B4').alignment.wrapText, true);
  assert.ok(scope.getRow(4).height > 30);
  // Also verify interoperability with the reader used elsewhere in the app.
  const external = XLSX.read(buffer, { type: 'buffer' });
  assert.equal(XLSX.utils.sheet_to_json(external.Sheets['Curva ABC']).length, 3);
});

test('identifiers and imported labels remain literal text, including leading zeros and formula-like content', async () => {
  const { book } = await roundtrip();
  const ws = book.getWorksheet('Curva ABC');
  for (const [address, expected] of [['B2', '=SUM(1,2)'], ['C2', '000001'], ['C3', '+FORMULA'], ['C4', '@FORMULA'], ['K2', 'id-0']]) {
    assert.equal(ws.getCell(address).value, expected);
    assert.equal(ws.getCell(address).formula, undefined);
  }
});

test('signed values remain numeric while amounts beyond Excel precision roundtrip as exact text', async () => {
  const sourceRows = [
    { ...rows[0], revenue: '900719925474099399', quantity: '123456789012345.123456' },
    { ...rows[1], revenue: '-1234', quantity: '-0.125' },
    { ...rows[2], revenue: '0', quantity: '0' },
  ];
  const { book } = await roundtrip(filters, { ...result, rows: sourceRows });
  const ws = book.getWorksheet('Curva ABC');
  assert.equal(ws.getCell('D2').value, '9007199254740993.99');
  assert.equal(ws.getCell('D2').numFmt, '@');
  assert.match(ws.getCell('D2').note, /precisão/);
  assert.equal(ws.getCell('E2').value, '123456789012345.123456');
  assert.equal(ws.getCell('D3').value, -12.34);
  assert.equal(ws.getCell('E3').value, -0.125);
  assert.equal(ws.getCell('D4').value, 0);
  assert.equal(ws.getCell('E4').value, 0);
  assert.equal(exportRow(sourceRows[0])[3], '9007199254740993.99');
});

test('empty rankings produce a readable workbook with headers and zero summary values', async () => {
  const empty = { ...result, rows: [], total: 0, revenue: '0', quantity: '0', orders: 0, top10: 0,
    classes: null };
  const { book } = await roundtrip(filters, empty);
  assert.equal(book.getWorksheet('Curva ABC').rowCount, 1);
  assert.equal(book.getWorksheet('Curva ABC').autoFilter, 'A1:K1');
  assert.equal(book.getWorksheet('Resumo').getCell('A7').value, 0);
  assert.equal(book.getWorksheet('Resumo').getCell('D10').value, 0);
  assert.equal(book.getWorksheet('Resumo').getCell('B13').value, 0);
  const sparse = await roundtrip(filters, { ...result, classes: { A: result.classes.A } });
  assert.equal(sparse.book.getWorksheet('Resumo').getCell('B14').value, 0);
});

test('composition and customer scopes retain their own labels, metric and classification mode', async () => {
  const composition = { ...result, composition: {} };
  const columns = EXPORT_COLUMNS.map((c, i) => i === 3 ? 'Valor atribuído ao produto (R$)' : c);
  const { book } = await roundtrip({ ...filters, grouping: 'composition', metric: 'quantity', mode: 'STRICT_CUMULATIVE' }, composition, columns);
  assert.equal(book.getWorksheet('Curva ABC').getCell('D1').value, columns[3]);
  const summary = book.getWorksheet('Resumo');
  assert.match(summary.getCell('A3').value, /Produtos base.*quantidade/);
  assert.match(summary.getCell('A6').value, /ATRIBUÍDO/);
  assert.match(summary.getCell('A18').value, /após o item/);
  const customers = await roundtrip({ ...filters, grouping: 'customer' });
  assert.match(customers.book.getWorksheet('Resumo').getCell('A3').value, /Clientes/);
});
