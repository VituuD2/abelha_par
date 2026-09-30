import type { ScanOrder } from "@/types";

export function orderReference(order: Pick<ScanOrder, "yampiId" | "nuvemshopNumber" | "numeroPedido">) {
  if (order.nuvemshopNumber) return `Nuvemshop #${order.nuvemshopNumber}`;
  if (order.yampiId) return `Yampi #${order.yampiId}`;
  return `Olist #${order.numeroPedido}`;
}
