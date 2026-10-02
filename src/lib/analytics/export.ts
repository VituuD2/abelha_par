import type { ABCFilters, ABCResult, ABCRow } from "./types";
export const EXPORT_COLUMNS = [
  "Ranking",
  "Entidade",
  "SKU",
  "Receita bruta dos itens (R$)",
  "Quantidade",
  "Pedidos",
  "Participação (%)",
  "Acumulado anterior (%)",
  "Acumulado (%)",
  "Classe",
  "Identidade",
];
export function exportRow(row: ABCRow): (string | number)[] {
  const cents = BigInt(row.revenue),
    absolute = cents < BigInt(0) ? -cents : cents;
  const money = `${cents < BigInt(0) ? "-" : ""}${absolute / BigInt(100)}.${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
  return [
    row.rank,
    row.name,
    row.sku,
    money,
    row.quantity,
    row.orders,
    row.percent,
    row.cumulativeBefore,
    row.cumulative,
    row.class,
    row.entityId,
  ];
}
/** Protect spreadsheet readers against formulas from names, SKUs or imported labels. */
export function csvCell(value: string | number) {
  let v = String(value);
  if (/^[\s]*[=+@-]/.test(v) || /^[\t\r]/.test(v)) v = "'" + v;
  return `"${v.replace(/"/g, '""')}"`;
}
export function exportMetadata(filters: ABCFilters, result: ABCResult) {
  return [
    ["Relatório", "Curva ABC"],
    ["Gerado em", result.generatedAt],
    [
      "Fonte canônica",
      "Olist; valor bruto dos itens, sem frete/despesas; cancelados excluídos",
    ],
    ["Período", `${filters.from} a ${filters.to}`],
    ["Agrupamento", filters.grouping],
    ["Métrica", filters.metric],
    ["Modo", filters.mode],
    ["Limites A/B", `${filters.thresholdA}/${filters.thresholdB}`],
    ["Base", filters.basis],
    ["Filtros", JSON.stringify(filters.selections)],
    ["Entidades", String(result.total)],
  ];
}
