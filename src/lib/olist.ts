import { extractYampiId } from "./regex";
import { normalizeOrderId } from "./order-id";
import type { OlistApiOrder, OlistOrder } from "@/types";

const API_BASE = "https://api.tiny.com.br/public-api/v3";
const WOOCOMMERCE_ECOMMERCE_ID = Number(process.env.OLIST_WOOCOMMERCE_ECOMMERCE_ID || "20161");
const DETAIL_CONCURRENCY = 2;
// Some accounts have limits below the published account maximum. Keep detail
// calls below ~55/minute; the dashboard resolves them in short requests.
const DETAIL_REQUEST_INTERVAL_MS = 1_100;
let nextDetailRequestAt = 0;

export class TinyRateLimitError extends Error {
  constructor(public readonly retryAfterSeconds: number) {
    super("Tiny rate limit reached");
  }
}

export class TinyApiError extends Error {
  constructor(
    public readonly operation: "detail" | "list",
    public readonly status: number,
    public readonly providerMessage: string | null,
    public readonly providerRequestId: string | null,
    public readonly orderId?: number
  ) {
    super(`Tiny ${operation} request failed with status ${status}`);
  }
}

export type OlistDateMode = "created" | "updated";

interface FetchOrdersParams {
  token: string;
  dateFrom: string;
  dateTo?: string;
  dateMode?: OlistDateMode;
}
interface TinyListResponse { itens?: OlistApiOrder[]; paginacao?: { total?: number } }

export interface TinyConnectionResult {
  ok: boolean;
  status: number;
  providerMessage: string | null;
  providerRequestId: string | null;
  wwwAuthenticate: string | null;
}

export async function testTinyConnection(token: string): Promise<TinyConnectionResult> {
  try {
    // Validate against the resource the application actually uses. `/info`
    // requires the separate "Informações da Conta" permission and therefore
    // produced a false disconnected state for applications allowed to read
    // only orders.
    const response = await fetch(`${API_BASE}/pedidos?limit=1`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    return {
      ok: response.ok,
      status: response.status,
      providerMessage: response.ok ? null : await getProviderErrorMessage(response),
      providerRequestId: getProviderRequestId(response),
      wwwAuthenticate: response.headers.get("www-authenticate"),
    };
  } catch {
    return {
      ok: false,
      status: 0,
      providerMessage: "Falha de rede ao consultar a Tiny.",
      providerRequestId: null,
      wwwAuthenticate: null,
    };
  }
}

function getProviderRequestId(response: Response) {
  return response.headers.get("x-request-id")
    || response.headers.get("x-correlation-id")
    || response.headers.get("x-amzn-requestid")
    || null;
}

async function getProviderErrorMessage(response: Response) {
  try {
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== "object") return null;
    const body = payload as Record<string, unknown>;
    const candidate = [body.message, body.mensagem, body.error, body.detail, body.title].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );
    return candidate ? candidate.slice(0, 500) : null;
  } catch {
    return null;
  }
}

export async function fetchOlistOrders({
  token,
  dateFrom,
  dateTo,
  dateMode = "created",
}: FetchOrdersParams): Promise<OlistOrder[]> {
  const allItems = new Map<number, OlistApiOrder>();
  const headers = { Authorization: `Bearer ${token}` };
  const endDate = dateTo || dateFrom;
  const queryDates = dateMode === "updated" ? enumerateDates(dateFrom, endDate) : [dateFrom];

  for (const queryDate of queryDates) {
    const items = await fetchOrdersPageRange(
      headers,
      dateMode === "created"
        ? { dataInicial: dateFrom, dataFinal: endDate }
        : { dataAtualizacao: queryDate }
    );
    for (const item of items) {
      if (isWooCommerceOrder(item)) allItems.set(item.id, item);
    }
  }

  // Keep the initial request short. Internal notes are resolved in batches by
  // the dedicated endpoint so a Vercel function never times out.
  return Array.from(allItems.values()).map(toListOrder);
}

async function fetchOrdersPageRange(headers: Record<string, string>, filters: Record<string, string>): Promise<OlistApiOrder[]> {
  const allItems: OlistApiOrder[] = [];
  const limit = 100;
  let offset = 0;
  let total = 0;

  do {
    const params = new URLSearchParams({
      ...filters,
      orderBy: "desc",
      limit: String(limit),
      offset: String(offset),
    });
    const response = await fetchTiny(`${API_BASE}/pedidos?${params}`, { headers });
    if (!response.ok) throw new Error(`Tiny API returned ${response.status}`);

    const data = await response.json() as TinyListResponse;
    allItems.push(...(data.itens || []));
    total = data.paginacao?.total || 0;
    offset += limit;
  } while (offset < total);
  return allItems;
}

export async function resolveOlistOrders(token: string, orderIds: number[]): Promise<OlistOrder[]> {
  const headers = { Authorization: `Bearer ${token}` };
  return mapWithConcurrency(orderIds, DETAIL_CONCURRENCY, async (id) => {
    const detail = await fetchOrderDetail(id, headers);
    return toOlistOrder(detail, headers, false);
  });
}

function isWooCommerceOrder(item: OlistApiOrder) {
  if (!item.ecommerce) return false;
  const channelName = item.ecommerce.nome
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return item.ecommerce.id === WOOCOMMERCE_ECOMMERCE_ID || channelName === "woocommerce";
}

function toListOrder(item: OlistApiOrder): OlistOrder {
  return {
    id: item.id,
    yampiId: getYampiIdFromDetail(item) || normalizeOrderId(item.ecommerce?.numeroPedidoEcommerce),
    trackingCode: item.transportador?.codigoRastreamento || "",
    clientName: item.cliente?.nome || "",
    numeroPedido: item.numeroPedido || 0,
    dataCriacao: getCreationDate(item),
    situacao: item.situacao ?? null,
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
    dataCriacao: getCreationDate(item),
    situacao: item.situacao ?? null,
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
      dataCriacao: getCreationDate(detail) || base.dataCriacao,
      situacao: detail.situacao ?? base.situacao,
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

function getCreationDate(order: OlistApiOrder) {
  const value = order.dataCriacao || order.data;
  return typeof value === "string" && value.trim() ? value : null;
}

function enumerateDates(dateFrom: string, dateTo: string) {
  const dates: string[] = [];
  const cursor = new Date(`${dateFrom}T12:00:00.000Z`);
  const end = new Date(`${dateTo}T12:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

async function fetchOrderDetail(orderId: number, headers: Record<string, string>): Promise<OlistApiOrder> {
  await waitForDetailSlot();
  const response = await fetchTiny(`${API_BASE}/pedidos/${orderId}`, { headers });
  if (!response.ok) {
    throw new TinyApiError(
      "detail",
      response.status,
      await getProviderErrorMessage(response),
      getProviderRequestId(response),
      orderId
    );
  }
  return response.json() as Promise<OlistApiOrder>;
}

async function fetchTiny(url: string, options: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { ...options, cache: "no-store" });
    if (response.status === 429) {
      const retryAfter = getRetryAfterSeconds(response);
      throw new TinyRateLimitError(retryAfter);
    }
    if (response.status < 500) return response;
    if (attempt === 2) return response;

    const delay = 1_000 * 2 ** attempt;
    await sleep(delay);
  }
  throw new Error("Tiny request retry loop exhausted");
}

function getRetryAfterSeconds(response: Response) {
  const candidate = Number(response.headers.get("retry-after") || response.headers.get("x-ratelimit-reset"));
  return Number.isFinite(candidate) && candidate > 0 ? Math.ceil(candidate) : 60;
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
