import "server-only";
import type { NuvemshopOrder, ReconciliationConfig } from "@/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/token-crypto";
import { getReconciliationConfig } from "@/lib/reconciliation-config";

const API_BASE = "https://api.nuvemshop.com.br/2025-03";
export class NuvemshopError extends Error {
  constructor(message: string, public status = 502, public retryAfterSeconds?: number) { super(message); }
}

export async function nuvemshopRequest(storeId: string, token: string, path: string, signal?: AbortSignal) {
  if (!/^\d+$/.test(storeId)) throw new NuvemshopError("Identificação da loja inválida.", 400);
  const response = await fetch(`${API_BASE}/${storeId}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": `Abelha Par (${process.env.APP_URL || "https://abelhapar.com.br"})`, Accept: "application/json" },
    cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000),
  });
  if (response.status === 429) {
    const resetMs = Number(response.headers.get("x-rate-limit-reset"));
    const retry = Number(response.headers.get("retry-after"));
    throw new NuvemshopError("A Nuvemshop limitou as consultas. Aguarde para tentar novamente.", 429,
      Math.max(1, Math.min(300, retry > 0 ? retry : resetMs > 0 ? Math.ceil(resetMs / 1000) : 30)));
  }
  if (response.status === 401 || response.status === 403) throw new NuvemshopError("A Nuvemshop recusou o acesso. Confira o token e a permissão de leitura de pedidos.", 403);
  if (!response.ok) throw new NuvemshopError(response.status === 404 ? "Loja ou pedido não encontrado na Nuvemshop." : "Não foi possível consultar a Nuvemshop.", response.status === 404 ? 404 : 502);
  return response;
}

export function normalizeNuvemshopOrder(value: unknown, storeId: string): NuvemshopOrder {
  if (!value || typeof value !== "object") throw new NuvemshopError("Pedido inválido recebido da Nuvemshop.");
  const row = value as Record<string, unknown>;
  if (!Number.isSafeInteger(row.id) || Number(row.id) <= 0 || !row.number || String(row.store_id) !== storeId) throw new NuvemshopError("A Nuvemshop retornou um pedido sem identificação válida.");
  const customer = row.customer as { name?: unknown } | undefined;
  const address = row.shipping_address as { name?: unknown } | undefined;
  const text = (v: unknown) => typeof v === "string" || typeof v === "number" ? String(v) : "";
  return {
    id: Number(row.id), storeId, number: text(row.number),
    clientName: text(customer?.name || row.contact_name || row.billing_name || address?.name).slice(0, 300),
    status: text(row.status), paymentStatus: text(row.payment_status), shippingStatus: text(row.shipping_status),
    createdAt: text(row.created_at), updatedAt: text(row.updated_at), total: text(row.total), currency: text(row.currency) || "BRL",
  };
}

export async function getNuvemshopConnection(ownerId: string) {
  const { data, error } = await createAdminClient().from("nuvemshop_integrations").select("store_id, access_token, olist_ecommerce_id, reference_field, reference_kind").eq("owner_id", ownerId).maybeSingle();
  if (error) throw new NuvemshopError("A conexão Nuvemshop ainda não está disponível no banco. Solicite a atualização da aplicação.", 503);
  if (!data) return null;
  const mapping: ReconciliationConfig | null = data.olist_ecommerce_id && data.reference_kind && data.reference_field
    ? { ecommerceId: Number(data.olist_ecommerce_id), referenceKind: data.reference_kind, referenceField: data.reference_field }
    : getReconciliationConfig();
  try { return { storeId: String(data.store_id), token: decryptToken(data.access_token), mapping }; }
  catch { throw new NuvemshopError("Não foi possível abrir a credencial Nuvemshop. Verifique a configuração do servidor ou conecte novamente.", 503); }
}

export async function cacheNuvemshopOrders(ownerId: string, orders: NuvemshopOrder[]) {
  if (!orders.length) return;
  const { error } = await createAdminClient().from("nuvemshop_order_cache").upsert(orders.map(order => ({ owner_id: ownerId, store_id: order.storeId, order_id: order.id, payload: order, fetched_at: new Date().toISOString() })), { onConflict: "owner_id,store_id,order_id" });
  if (error) throw new NuvemshopError("Não foi possível guardar os pedidos consultados. Tente novamente.", 503);
}
