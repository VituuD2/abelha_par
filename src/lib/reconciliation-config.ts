import "server-only";
import type { ReconciliationConfig } from "@/types";

export function getReconciliationConfig(): ReconciliationConfig | null {
  const ecommerceId = Number(process.env.OLIST_NUVEMSHOP_ECOMMERCE_ID);
  const kind = process.env.NUVEMSHOP_OLIST_REFERENCE_KIND;
  const field = process.env.NUVEMSHOP_OLIST_REFERENCE_FIELD;
  if (!Number.isSafeInteger(ecommerceId) || ecommerceId <= 0 || !["id", "number"].includes(kind || "")
    || !["numeroPedidoEcommerce", "numeroPedidoCanalVenda"].includes(field || "")) return null;
  return { ecommerceId, referenceKind: kind as "id" | "number", referenceField: field === "numeroPedidoCanalVenda" ? "ecommerceChannelOrderNumber" : "ecommerceOrderNumber" };
}
