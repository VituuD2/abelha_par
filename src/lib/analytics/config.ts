/** The menu name is deliberately centralized; page content uses Curva ABC. */
export const NECTAR_MODULE = {
  name: "Néctar",
  href: "/analytics/abc",
  title: "Curva ABC",
} as const;
export const ABC_DEFAULTS = {
  mode: "TINY_LEGACY",
  thresholdA: 80,
  thresholdB: 95,
  metric: "revenue",
  statuses: [1, 5, 6],
} as const;
export const ORDER_STATUSES: Record<number, string> = {
  0: "Aberto",
  1: "Faturado",
  2: "Cancelado",
  3: "Aprovado",
  4: "Preparando",
  5: "Enviado",
  6: "Entregue",
  7: "Pronto",
  8: "Incompleto",
  9: "Não entregue",
};
export const DIMENSIONS = {
  companies: "Empresas",
  connections: "Conexões Olist",
  sources: "Integrações / origens",
  sourceKinds: "Tipos de origem",
  channels: "Canais",
  marketplaces: "Marketplaces",
  stores: "Lojas",
  accounts: "Contas externas",
  statuses: "Situações",
  products: "Produtos",
  skus: "SKUs",
  parents: "Produtos pai",
  categories: "Categorias",
  brands: "Marcas",
  customers: "Clientes",
  tags: "Marcadores",
  natures: "Naturezas de operação",
  sellers: "Vendedores",
  states: "Estados",
} as const;
