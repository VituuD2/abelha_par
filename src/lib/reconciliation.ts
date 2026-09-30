import type { NuvemshopOrder, OlistOrder, ReconciliationConfig, ScanOrder } from "@/types";
import { normalizeTrackingForScan } from "@/lib/tracking";

export interface ReconciliationIssue { orderNumber: string; message: string }
export interface ReconciliationResult { orders: ScanOrder[]; issues: ReconciliationIssue[]; ignored: number }

export function normalizeExternalReference(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim().replace(/^#\s*/, "") : "";
}

export function reconcileOrders(selected: NuvemshopOrder[], olistOrders: OlistOrder[], config: ReconciliationConfig): ReconciliationResult {
  const issues: ReconciliationIssue[] = [];
  const orders: ScanOrder[] = [];
  const candidates = olistOrders.filter(order => order.ecommerceId === config.ecommerceId);
  const usedOlist = new Set<number>();
  const selectedIds = new Set<number>();
  const storeIds = new Set(selected.map(order => order.storeId));
  if (storeIds.size > 1) return { orders: [], issues: [{ orderNumber: "—", message: "A seleção contém pedidos de lojas diferentes." }], ignored: olistOrders.length };
  for (const order of selected) {
    const issue = (message: string) => issues.push({ orderNumber: order.number, message });
    if (selectedIds.has(order.id)) { issue("Pedido repetido na seleção."); continue; }
    selectedIds.add(order.id);
    if (order.status === "cancelled") { issue("Pedido cancelado na Nuvemshop."); continue; }
    if (order.paymentStatus !== "paid") { issue("Pagamento não está integralmente confirmado na Nuvemshop."); continue; }
    const reference = normalizeExternalReference(config.referenceKind === "id" ? order.id : order.number);
    const matches = candidates.filter(candidate => reference && normalizeExternalReference(candidate[config.referenceField]) === reference);
    if (matches.length === 0) { issue("Não encontrado na busca Olist. Amplie o período ou aguarde a integração."); continue; }
    if (matches.length > 1 || usedOlist.has(matches[0].id)) { issue("Vínculo ambíguo: mais de uma correspondência entre as plataformas."); continue; }
    const match = matches[0];
    if (match.situacao === null || match.situacao === 2) { issue("Pedido cancelado ou sem situação válida na Olist."); continue; }
    usedOlist.add(match.id);
    orders.push({ ...match, yampiId: null, nuvemshopId: order.id, nuvemshopNumber: order.number, nuvemshopStoreId: order.storeId, status: "pending" });
  }
  const codes = new Map<string, ScanOrder[]>();
  for (const order of orders) {
    const code = normalizeTrackingForScan(order.trackingCode);
    if (code) codes.set(code, [...(codes.get(code) || []), order]);
  }
  for (const duplicates of codes.values()) {
    if (duplicates.length > 1) for (const order of duplicates) issues.push({ orderNumber: order.nuvemshopNumber!, message: "Rastreio compartilhado por mais de um pedido. Revise o agrupamento antes de bipar." });
  }
  return { orders, issues, ignored: olistOrders.filter(order => !usedOlist.has(order.id)).length };
}
