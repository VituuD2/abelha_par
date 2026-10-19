import type { ABCFilters, ABCResult, ABCRow } from "./types";
import { reportReliability, type CoverageStatus } from "./reliability";
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
      "Olist; valor bruto dos itens, sem frete/despesas; descontos globais e devoluções não deduzidos; cancelados excluídos",
    ],
    ["Período", `${filters.from} a ${filters.to}`],
    ["Agrupamento", filters.grouping],
    ["Métrica", filters.metric],
    ["Modo", filters.mode],
    ["Limites A/B", `${filters.thresholdA}/${filters.thresholdB}`],
    ["Base", filters.basis],
    ["Filtros", JSON.stringify(filters.selections)],
    ["Entidades", String(result.total)],
    ...(result.composition ? [
      ["Composição · versão", result.composition.version],
      ["Composição · quantidade", "Unidades do produto base = quantidade vendida × fator documentado"],
      ["Composição · valor", "Rateio por CMV de referência × quantidade de cada componente; centavos residuais pelos maiores restos, com desempate por SKU"],
      ["Composição · fonte do CMV", result.composition.costSource ? `${result.composition.costSource.file}; aba ${result.composition.costSource.sheet}; coluna ${result.composition.costSource.column}; SHA-256 ${result.composition.costSource.sha256}` : "Não informada"],
      ["Composição · valor original (centavos)", result.composition.originalRevenue],
      ["Composição · valor atribuído (centavos)", result.revenue],
      ["Composição · valor sem rateio (centavos)", result.composition.unallocatedRevenue],
      ["Composição · linhas sem rateio", String(result.composition.unallocatedLines)],
      ["Composição · CMV pendente", (result.composition.missingCostSkus || []).join(", ")],
      ["Composição · filtros", "SKU/produto/pai selecionam registros originais antes da consolidação"],
      ["Composição · SKUs pendentes", String(result.composition.pendingTotal)],
      ["Composição · componentes auxiliares desconsiderados", (result.composition.ignoredComponentSkus || []).join(", ")],
    ] : []),
  ];
}

export function exportCoverageMetadata(filters: ABCFilters, status: CoverageStatus) {
  const scope = reportReliability(status, filters);
  return [
    ["Confiabilidade", "Análise provisória; reconciliação financeira com o ERP não comprovada"],
    ["Cobertura no período", scope.complete ? "Importada" : "Parcial ou não confirmada"],
    ["Estado de sincronização", scope.state],
    ["Empresas selecionadas", scope.companies.map(c => c.name).join(" + ")],
    ["Itens sem vínculo", "Separados por pedido; não consolidados por SKU/nome; identificados na tabela"],
    ...scope.companies.filter(c => !scope.connections.some(conn => conn.company_id === c.id))
      .map(c => ["Empresa pendente", c.name + ": sem conexão"]),
    ...scope.connections.flatMap(c => [
      ["Conexão", c.name],
      ["Última importação · " + c.name, c.last_synced_at || "Não registrada"],
      ["Pendência · " + c.name, c.last_error || (!c.enabled ? "Pausada" : !c.verified_at ? "CNPJ não validado" : "Sem erro informado")],
      ...(status.coverage || status.jobs).filter(j => j.connection_id === c.id && j.status === "completed" && (j.mode === "backfill" || j.covers_sales) &&
        j.from_date <= filters.to && j.to_date >= filters.from)
        .map(j => ["Intervalo importado · " + c.name, `${j.from_date < filters.from ? filters.from : j.from_date} a ${j.to_date > filters.to ? filters.to : j.to_date}`]),
    ]),
  ];
}
