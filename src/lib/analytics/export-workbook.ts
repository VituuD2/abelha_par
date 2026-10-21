import { Workbook, type Cell, type Fill, type Row, type Worksheet } from "exceljs";
import { exportMoney, exportRow } from "./export";
import type { ABCFilters, ABCResult } from "./types";

// Match the amber, yellow and stone classes used by the dashboard.
const classes = {
  A: { background: "FFFFF7ED", badge: "FFFED7AA", text: "FF9A3412" },
  B: { background: "FFFEFCE8", badge: "FFFEF08A", text: "FF854D0E" },
  C: { background: "FFF5F5F4", badge: "FFE7E5E4", text: "FF57534E" },
} as const;
const ink = "FF292524", muted = "FF78716C", header = "FF78350F";
const formats = {
  money: '"R$" #,##0.00;[Red]-"R$" #,##0.00;"R$" 0.00',
  quantity: '#,##0.######;[Red]-#,##0.######;0',
  integer: "#,##0",
  percent: "0.00%",
};
const fill = (argb: string): Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

/** Excel retains only 15 significant digits. Keep larger decimals as exact text. */
function decimal(value: string): number | string {
  const digits = value.replace(/^-/, "").replace(".", "").replace(/^0+/, "");
  const number = Number(value);
  return digits.length <= 15 && Number.isFinite(number) ? number : value;
}

function numeric(cell: Cell, value: string | number, format: string) {
  cell.value = typeof value === "string" ? decimal(value) : value;
  cell.numFmt = typeof cell.value === "number"
    ? format === formats.quantity && Number.isInteger(cell.value) ? formats.integer : format
    : "@";
  cell.alignment = { horizontal: "right", vertical: "middle" };
  if (typeof cell.value === "string") {
    cell.note = "Valor preservado como texto para evitar perda de precisão no Excel. Separador decimal original: ponto.";
  }
}

function styleHeader(row: Row) {
  row.height = 40;
  row.eachCell(cell => {
    cell.fill = fill(header);
    cell.font = { name: "Aptos", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FFD97706" } } };
  });
}

function sheet(book: Workbook, name: string, tabColor: string, landscape = true) {
  const ws = book.addWorksheet(name, {
    properties: { defaultRowHeight: 24, tabColor: { argb: tabColor } },
    views: [{ showGridLines: false, zoomScale: 90 }],
    pageSetup: {
      paperSize: 9, orientation: landscape ? "landscape" : "portrait",
      fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.15, footer: 0.15 },
    },
    headerFooter: { oddFooter: "&LCurva ABC&RPágina &P de &N" },
  });
  return ws;
}

function band(ws: Worksheet, range: string, value: string, background: string, color = ink, size = 11) {
  ws.mergeCells(range);
  const cell = ws.getCell(range.split(":")[0]);
  cell.value = value;
  cell.fill = fill(background);
  cell.font = { name: "Aptos", size, color: { argb: color }, bold: size >= 14 };
  cell.alignment = { vertical: "middle", wrapText: true, indent: 1 };
}

function date(value: string) {
  return value.slice(0, 10).split("-").reverse().join("/");
}

function summary(book: Workbook, filters: ABCFilters, result: ABCResult, metadata: string[][]) {
  const ws = sheet(book, "Resumo", "FFD97706");
  ws.columns = [14, 20, 20, 21, 20, 20].map(width => ({ width }));
  band(ws, "A1:F2", "CURVA ABC · RESUMO", header, "FFFFFFFF", 22);
  band(ws, "A3:F3", `${date(filters.from)} a ${date(filters.to)} · ${
    { product: "Produtos Olist", composition: "Produtos base", parent: "Produtos pai", customer: "Clientes" }[filters.grouping]
  } · Classificação por ${filters.metric === "quantity" ? "quantidade" : "valor"}`, "FFFFF7ED");
  band(ws, "A4:F4", `Gerado em ${new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(result.generatedAt))} · Horário de São Paulo`, "FFFFFFFF", muted, 10);

  const cards: [string, string, string | number, string][] = [
    ["A6:C6", result.composition ? "VALOR ATRIBUÍDO AOS PRODUTOS" : "VALOR BRUTO DOS ITENS", exportMoney(result.revenue), formats.money],
    ["D6:F6", "QUANTIDADE VENDIDA", result.quantity, formats.quantity],
    ["A9:C9", "PEDIDOS DISTINTOS / ENTIDADES", `${result.orders.toLocaleString("pt-BR")} / ${result.total.toLocaleString("pt-BR")}`, "@"],
    ["D9:F9", "CONCENTRAÇÃO DOS 10 PRIMEIROS", result.top10 / 100, formats.percent],
  ];
  cards.forEach(([range, label, value, format]) => {
    band(ws, range, label, "FFF5F5F4", muted, 10);
    const valueRange = range.replace(/\d+/g, n => String(Number(n) + 1));
    band(ws, valueRange, "", "FFF5F5F4", ink, 20);
    const cell = ws.getCell(valueRange.split(":")[0]);
    if (format === "@") cell.value = value;
    else numeric(cell, value, format);
    ws.getRow(Number(cell.row)).height = 38;
  });

  const heading = ws.getRow(12);
  heading.values = ["Classe", "Entidades", result.composition ? "Valor atribuído (R$)" : "Valor bruto (R$)", "Quantidade", "Participação na métrica", "Perfil"];
  styleHeader(heading);
  (["A", "B", "C"] as const).forEach((key, index) => {
    // SQL omits classes without entities and returns null for an empty report.
    const values = result.classes?.[key] || { count: 0, revenue: "0", quantity: "0", percent: 0 };
    const palette = classes[key];
    const row = ws.getRow(13 + index);
    row.values = [`Classe ${key}`, values.count, null, null, values.percent / 100, { A: "Maior concentração", B: "Intermediária", C: "Cauda da curva" }[key]];
    row.height = 32;
    // Include numeric cells that were intentionally left empty above.
    for (let col = 1; col <= 6; col++) {
      const cell = row.getCell(col);
      cell.fill = fill(col === 1 ? palette.badge : palette.background);
      cell.font = { name: "Aptos", size: 11, bold: col === 1, color: { argb: col === 1 ? palette.text : ink } };
      cell.alignment = { vertical: "middle", horizontal: col === 1 ? "center" : col === 6 ? "left" : "right" };
    }
    numeric(row.getCell(2), values.count, formats.integer);
    numeric(row.getCell(3), exportMoney(values.revenue), formats.money);
    numeric(row.getCell(4), values.quantity, formats.quantity);
    numeric(row.getCell(5), values.percent / 100, formats.percent);
  });
  band(ws, "A17:F17", `LIMITES · A: ${filters.thresholdA}% · B: ${filters.thresholdB}% · C: restante da curva`, header, "FFFFFFFF");
  band(ws, "A18:F19", filters.mode === "TINY_LEGACY"
    ? "Modo Tiny histórico: a classe considera o acumulado anterior ao item. Ao atingir um limite, a próxima faixa é aplicada."
    : "Modo estrito: a classe considera o acumulado após o item. Ao atingir um limite, a próxima faixa é aplicada.", "FFFFF7ED");
  band(ws, "A21:F22", "LEITURA · A, B e C mantêm as mesmas cores no resumo e no ranking. Na aba Curva ABC, filtre pelos cabeçalhos; posição, nome e SKU permanecem fixos ao rolar. A coluna Identidade está disponível ao reexibir a coluna K.", "FFF5F5F4");
  band(ws, "A24:F25", `COBERTURA · ${metadata.find(([key]) => key === "Cobertura no período")?.[1] || "Não informada"}. ${metadata.find(([key]) => key === "Confiabilidade")?.[1] || "Consulte a aba Escopo para verificar a origem e os filtros."}`, "FFFEF3C7", header);
  band(ws, "A27:F28", "Valores monetários e quantidades usam células numéricas. Valores acima da precisão do Excel são preservados como texto, com uma nota na célula. Pedidos são distintos no período; não some a coluna Pedidos do ranking, pois um pedido pode conter várias entidades.", "FFFFFFFF", muted, 10);
  ws.pageSetup.printArea = "A1:F28";
  ws.pageSetup.fitToHeight = 1;
}

export function createABCWorkbook(filters: ABCFilters, result: ABCResult, metadata: string[][], columns: string[]) {
  const book = new Workbook();
  book.creator = "Néctar";
  book.title = "Curva ABC";
  book.subject = `Curva ABC de ${filters.from} a ${filters.to}`;
  book.created = new Date(result.generatedAt);
  book.modified = new Date(result.generatedAt);
  summary(book, filters, result, metadata);

  const ranking = sheet(book, "Curva ABC", "FFF59E0B");
  const nameWidth = result.rows.reduce((width, row) => Math.min(64, Math.max(width, row.name.length + 2)), 36);
  const skuWidth = result.rows.reduce((width, row) => Math.min(32, Math.max(width, row.sku.length + 2)), 18);
  ranking.columns = [11, nameWidth, skuWidth, 25, 18, 13, 19, 22, 19, 12, 40].map(width => ({ width }));
  ranking.getColumn(11).hidden = true;
  ranking.views = [{ state: "frozen", xSplit: 3, ySplit: 1, topLeftCell: "D2", activeCell: "D2", showGridLines: false, zoomScale: 85 }];
  styleHeader(ranking.addRow(columns));
  ranking.getCell("D1").note = result.composition ? "Valor da venda atribuído ao produto base conforme as regras de composição descritas na aba Escopo." : "Receita bruta dos itens; sem frete/despesas, descontos globais ou devoluções. Cancelados excluídos.";
  ranking.getCell("F1").note = "Pedidos distintos por entidade. Um mesmo pedido pode aparecer em várias entidades; esta coluna não deve ser somada.";
  ranking.getCell("G1").note = `Participação na métrica aplicada: ${filters.metric === "quantity" ? "quantidade" : "receita"}.`;
  for (const item of result.rows) {
    const values = exportRow(item), row = ranking.addRow(values), palette = classes[item.class];
    const lines = (value: string, width: number) => value.split(/\r?\n/).reduce((count, line) => count + Math.max(1, Math.ceil(line.length / (width - 2))), 0);
    row.height = Math.min(120, Math.max(28, Math.max(lines(item.name, nameWidth), lines(item.sku, skuWidth)) * 15 + 10));
    row.eachCell(cell => {
      cell.font = { name: "Aptos", size: 11, color: { argb: ink } };
      cell.fill = fill(palette.background);
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = { bottom: { style: "hair", color: { argb: "FFE7E5E4" } } };
    });
    row.getCell(2).alignment = { vertical: "middle", wrapText: true };
    row.getCell(3).alignment = { vertical: "middle", wrapText: true };
    row.getCell(3).numFmt = "@";
    numeric(row.getCell(1), item.rank, formats.integer);
    numeric(row.getCell(4), values[3], formats.money);
    numeric(row.getCell(5), item.quantity, formats.quantity);
    numeric(row.getCell(6), item.orders, formats.integer);
    [item.percent, item.cumulativeBefore, item.cumulative].forEach((value, index) => numeric(row.getCell(index + 7), value / 100, formats.percent));
    const badge = row.getCell(10);
    badge.fill = fill(palette.badge);
    badge.font = { name: "Aptos", size: 12, bold: true, color: { argb: palette.text } };
    badge.alignment = { horizontal: "center", vertical: "middle" };
  }
  ranking.autoFilter = { from: "A1", to: `K${Math.max(1, ranking.rowCount)}` };
  ranking.pageSetup.printTitlesRow = "1:1";
  ranking.pageSetup.printArea = `A1:J${Math.max(1, ranking.rowCount)}`;

  const scope = sheet(book, "Escopo", "FFA8A29E");
  scope.columns = [{ width: 48 }, { width: 110 }];
  scope.views = [{ state: "frozen", ySplit: 1, showGridLines: false, zoomScale: 85 }];
  styleHeader(scope.addRow(["Campo", "Descrição / valor aplicado"]));
  metadata.forEach(([key, value], index) => {
    const row = scope.addRow([key, value]);
    row.height = Math.max(30, Math.max(Math.ceil(key.length / 43), value.split(/\r?\n/).reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 100)), 0)) * 15 + 12);
    row.eachCell((cell, col) => {
      cell.fill = fill(index % 2 ? "FFFFFFFF" : "FFFAFAF9");
      cell.font = { name: "Aptos", size: 11, bold: col === 1, color: { argb: ink } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
    if (["Confiabilidade", "Cobertura no período"].includes(key)) row.eachCell(cell => { cell.fill = fill("FFFEF3C7"); });
  });
  scope.pageSetup.printTitlesRow = "1:1";
  scope.pageSetup.printArea = `A1:B${scope.rowCount}`;
  return book;
}
