export type ABCMode = "TINY_LEGACY" | "STRICT_CUMULATIVE";
export type ABCMetric = "revenue" | "quantity";
export type ABCGrouping = "product" | "parent" | "customer" | "composition";
export type CostSyncStatus = {
  connection_id?: string;
  page_offset?: number;
  last_synced_at?: string | null;
  last_error?: string | null;
  next_at?: string;
  updated_at?: string;
  history?: { total: number; completed: number; pending: number; last_synced_at: string | null; last_error: string | null; updated_at: string | null } | null;
};
export type Dimension =
  | "companies"
  | "connections"
  | "sources"
  | "sourceKinds"
  | "channels"
  | "marketplaces"
  | "stores"
  | "accounts"
  | "statuses"
  | "products"
  | "skus"
  | "parents"
  | "categories"
  | "brands"
  | "customers"
  | "tags"
  | "natures"
  | "sellers"
  | "states";
export interface ABCFilters {
  from: string;
  to: string;
  metric: ABCMetric;
  mode: ABCMode;
  grouping: ABCGrouping;
  thresholdA: number;
  thresholdB: number;
  basis: "orders" | "invoiced";
  costBasis?: "average" | "purchase";
  selections: Partial<Record<Dimension, string[]>>;
}
export interface ABCRow {
  entityId: string;
  name: string;
  sku: string;
  revenue: string;
  quantity: string;
  orders: number;
  rank: number;
  percent: number;
  cumulativeBefore: number;
  cumulative: number;
  class: "A" | "B" | "C";
}
export interface ABCResult {
  rows: ABCRow[];
  total: number;
  revenue: string;
  quantity: string;
  orders: number;
  classes: Record<
    "A" | "B" | "C",
    { count: number; revenue: string; quantity: string; percent: number }
  >;
  top10: number;
  pareto: ABCRow[];
  generatedAt: string;
  composition?: {
    version: string;
    revenuePolicy: "cost";
    costSource: import("./composition").CompositionCostSource;
    originalRevenue: string;
    unallocatedRevenue: string;
    unallocatedLines: number;
    mixedLines: number;
    missingCostSkus: string[];
    ignoredComponentSkus?: string[];
    mappedEntities: number;
    periodCostCents?: string | null;
    knownCostCents?: string;
    costMissingLines?: number;
    pendingTotal: number;
    pending: { sku: string; name: string; reason: string; orders: number }[];
  };
}
export interface AnalyticsConnection {
  id: string;
  workspace_id: string;
  company_id: string;
  name: string;
  enabled: boolean;
  legacy_integration_id: string | null;
  client_id: string | null;
  client_secret: string | null;
  access_token: string | null;
  refresh_token: string | null;
  expires_at: string | null;
  refresh_expires_at: string | null;
  version: number;
  refresh_lock: string | null;
  refresh_locked_until: string | null;
  verified_tax_id: string | null;
  last_synced_at: string | null;
}
export interface SyncJob {
  id: string;
  workspace_id: string;
  connection_id: string;
  mode: "backfill" | "incremental";
  from_date: string;
  to_date: string;
  cursor_date: string;
  page_offset: number;
  pending_ids: string[];
  pending_index: number;
  page_done: boolean;
  processed: number;
  pages: number;
  attempts: number;
  lease_token: string;
  query_phase?: "sales" | "updates";
  covers_sales?: boolean;
}
export interface Option {
  value: string;
  label: string;
}
