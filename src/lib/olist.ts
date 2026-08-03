import { extractYampiId } from "./regex";
import type { OlistApiOrder, OlistOrder } from "@/types";

const API_BASE = "https://api.tiny.com.br/public-api/v3";
const DETAIL_CONCURRENCY = 3;

interface FetchOrdersParams { token: string; dateFrom: string; dateTo?: string }
interface TinyListResponse { itens?: OlistApiOrder[]; paginacao?: { total?: number } }

export async function testTinyConnection(token: string): Promise<{ ok: boolean; status: number }> {
  try {
    const response = await fetch(`${API_BASE}/info`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function fetchOlistOrders({ token, dateFrom, dateTo }: FetchOrdersParams): Promise<OlistOrder[]> {
  const allOrders: OlistOrder[] = [];
  const headers = { Authorization: `Bearer ${token}` };
  const limit = 100;
  let offset = 0;
  let total = 0;

  do {
    const params = new URLSearchParams({ dataInicial: dateFrom, dataFinal: dateTo || dateFrom, limit: String(limit), offset: String(offset) });
    const response = await fetch(`${API_BASE}/pedidos?${params}`, { headers, cache: "no-store" });
    if (!response.ok) throw new Error(`Tiny API returned ${response.status}`);

    const data = await response.json() as TinyListResponse;
    const items = (data.itens || []).filter(isWooCommerceOrder);
    const mapped = await mapWithConcurrency(items, DETAIL_CONCURRENCY, (item) => toOlistOrder(item, headers));
    allOrders.push(...mapped);
    total = data.paginacao?.total || 0;
    offset += limit;
  } while (offset < total);

  return allOrders;
}

function isWooCommerceOrder(item: OlistApiOrder) {
  return !item.ecommerce || item.ecommerce.id === 20161 || item.ecommerce.nome.toLowerCase() === "woocommerce";
}

async function toOlistOrder(item: OlistApiOrder, headers: Record<string, string>): Promise<OlistOrder> {
  const numeroPedido = item.numeroPedido || 0;
  const base = {
    id: item.id,
    yampiId: item.ecommerce?.numeroPedidoEcommerce?.trim() || (numeroPedido ? String(numeroPedido).trim() : null),
    trackingCode: item.transportador?.codigoRastreamento || "",
    clientName: item.cliente?.nome || "",
    numeroPedido,
  };
  if (base.yampiId) return base;

  try {
    const detail = await fetchOrderDetail(item.id, headers);
    if (!isWooCommerceOrder(detail)) return { ...base, yampiId: null };
    return {
      id: detail.id,
      yampiId: detail.ecommerce?.numeroPedidoEcommerce?.trim() || extractYampiId(`${detail.observacoes || ""} ${detail.observacaoInterna || ""}`) || String(detail.numeroPedido || "").trim() || null,
      trackingCode: detail.transportador?.codigoRastreamento || base.trackingCode,
      clientName: detail.cliente?.nome || base.clientName,
      numeroPedido: detail.numeroPedido || numeroPedido,
    };
  } catch {
    return { ...base, yampiId: null };
  }
}

async function fetchOrderDetail(orderId: number, headers: Record<string, string>): Promise<OlistApiOrder> {
  const response = await fetch(`${API_BASE}/pedidos/${orderId}`, { headers, cache: "no-store" });
  if (!response.ok) throw new Error(`Tiny detail returned ${response.status}`);
  return response.json() as Promise<OlistApiOrder>;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}
