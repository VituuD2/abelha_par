import { extractYampiId } from "./regex";
import { normalizeOrderId } from "./order-id";
import type { OlistApiOrder, OlistOrder } from "@/types";

const API_BASE = "https://api.tiny.com.br/public-api/v3";
const DETAIL_CONCURRENCY = 2;
// Olist documents a 120 requests/minute account-wide limit. 520 ms leaves a
// small margin for the list and connection-status requests.
const DETAIL_REQUEST_INTERVAL_MS = 520;
let nextDetailRequestAt = 0;

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
  const allItems: OlistApiOrder[] = [];
  const headers = { Authorization: `Bearer ${token}` };
  const limit = 100;
  let offset = 0;
  let total = 0;

  do {
    const params = new URLSearchParams({ dataInicial: dateFrom, dataFinal: dateTo || dateFrom, limit: String(limit), offset: String(offset) });
    const response = await fetchTiny(`${API_BASE}/pedidos?${params}`, { headers });
    if (!response.ok) throw new Error(`Tiny API returned ${response.status}`);

    const data = await response.json() as TinyListResponse;
    allItems.push(...(data.itens || []).filter(isWooCommerceOrder));
    total = data.paginacao?.total || 0;
    offset += limit;
  } while (offset < total);

  // Keep the initial request short. Internal notes are resolved in batches by
  // the dedicated endpoint so a Vercel function never times out.
  return allItems.map(toListOrder);
}

export async function resolveOlistOrders(token: string, orderIds: number[]): Promise<OlistOrder[]> {
  const headers = { Authorization: `Bearer ${token}` };
  return mapWithConcurrency(orderIds, DETAIL_CONCURRENCY, async (id) => {
    const detail = await fetchOrderDetail(id, headers);
    return toOlistOrder(detail, headers, false);
  });
}

function isWooCommerceOrder(item: OlistApiOrder) {
  return !item.ecommerce || item.ecommerce.id === 20161 || item.ecommerce.nome.toLowerCase() === "woocommerce";
}

function toListOrder(item: OlistApiOrder): OlistOrder {
  return {
    id: item.id,
    yampiId: getYampiIdFromDetail(item) || normalizeOrderId(item.ecommerce?.numeroPedidoEcommerce),
    trackingCode: item.transportador?.codigoRastreamento || "",
    clientName: item.cliente?.nome || "",
    numeroPedido: item.numeroPedido || 0,
  };
}

async function toOlistOrder(item: OlistApiOrder, headers: Record<string, string>, fetchDetail = true): Promise<OlistOrder> {
  const numeroPedido = item.numeroPedido || 0;
  const base = {
    id: item.id,
    yampiId: getYampiIdFromDetail(item) || normalizeOrderId(item.ecommerce?.numeroPedidoEcommerce),
    trackingCode: item.transportador?.codigoRastreamento || "",
    clientName: item.cliente?.nome || "",
    numeroPedido,
  };
  // The list endpoint normally does not contain internal notes. Always fetch
  // the detail unless the note was already supplied by the list response.
  if (getYampiIdFromDetail(item) || !fetchDetail) return base;

  try {
    const detail = await fetchOrderDetail(item.id, headers);
    if (!isWooCommerceOrder(detail)) return { ...base, yampiId: null };
    return {
      id: detail.id,
      // The business identifier comes from the Tiny internal notes, not numeroPedido.
      yampiId: getYampiIdFromDetail(detail) || normalizeOrderId(detail.ecommerce?.numeroPedidoEcommerce) || base.yampiId,
      trackingCode: detail.transportador?.codigoRastreamento || base.trackingCode,
      clientName: detail.cliente?.nome || base.clientName,
      numeroPedido: detail.numeroPedido || numeroPedido,
    };
  } catch {
    return { ...base, yampiId: null };
  }
}

function getYampiIdFromDetail(detail: OlistApiOrder) {
  const internalNotes = [
    detail.observacoesInternas,
    detail.observacoes_internas,
    detail.observacaoInterna,
    detail.observacao_interna,
    detail.observacoes,
  ].filter((value): value is string => typeof value === "string");
  return normalizeOrderId(extractYampiId(internalNotes.join("\n")));
}

async function fetchOrderDetail(orderId: number, headers: Record<string, string>): Promise<OlistApiOrder> {
  await waitForDetailSlot();
  const response = await fetchTiny(`${API_BASE}/pedidos/${orderId}`, { headers });
  if (!response.ok) throw new Error(`Tiny detail returned ${response.status}`);
  return response.json() as Promise<OlistApiOrder>;
}

async function fetchTiny(url: string, options: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { ...options, cache: "no-store" });
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt === 2) return response;

    const retryAfterSeconds = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : 1_000 * 2 ** attempt;
    await sleep(delay);
  }
  throw new Error("Tiny request retry loop exhausted");
}

async function waitForDetailSlot() {
  const now = Date.now();
  const scheduled = Math.max(now, nextDetailRequestAt);
  nextDetailRequestAt = scheduled + DETAIL_REQUEST_INTERVAL_MS;
  await sleep(scheduled - now);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
