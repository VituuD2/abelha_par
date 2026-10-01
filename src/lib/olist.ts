import { extractYampiId } from "./regex";
import { normalizeOrderId } from "./order-id";
import { normalizeExternalReference } from "./reconciliation";
import type { OlistApiOrder, OlistOrder } from "@/types";

const API_BASE = "https://api.tiny.com.br/public-api/v3";
const DETAIL_CONCURRENCY = 2;
// Some accounts have limits below the published account maximum. Keep detail
// calls below 30/minute per process; provider throttling is also respected.
const DETAIL_REQUEST_INTERVAL_MS = 2_100;
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
  ecommerceId?: number;
}
interface TinyListResponse { itens?: OlistApiOrder[]; paginacao?: { total?: number } }

export async function fetchOlistOrdersPage({ token, dateFrom, dateTo = dateFrom, dateMode = "created", ecommerceId, cursor = { day: 0, offset: 0 } }: FetchOrdersParams & { cursor?: { day: number; offset: number } }) {
  const dates = dateMode === "updated" ? enumerateDates(dateFrom, dateTo) : [dateFrom];
  if (!dates[cursor.day]) throw new Error("Página de consulta inválida.");
  const filters: Record<string, string> = dateMode === "updated" ? { dataAtualizacao: dates[cursor.day] } : { dataInicial: dateFrom, dataFinal: dateTo };
  const params = new URLSearchParams({ ...filters, orderBy: "desc", limit: "100", offset: String(cursor.offset) });
  const response = await fetchTiny(`${API_BASE}/pedidos?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new TinyApiError("list", response.status, await getProviderErrorMessage(response), getProviderRequestId(response));
  const data = await response.json() as TinyListResponse;
  if (!Array.isArray(data.itens)) throw new Error("Resposta inválida da Olist.");
  const hasMore = data.paginacao?.total !== undefined ? cursor.offset + 100 < data.paginacao.total : data.itens.length === 100;
  const nextCursor = hasMore ? { day: cursor.day, offset: cursor.offset + 100 } : cursor.day + 1 < dates.length ? { day: cursor.day + 1, offset: 0 } : null;
  return {
    orders: data.itens.filter(item => isNuvemshopOrder(item, ecommerceId)).map(item => ({
      ...normalizeOlistOrder(item),
      // Explicit nulls are valid (e.g. a label not generated yet). Missing fields
      // require a detail lookup; do not silently turn an incomplete list into a fresh snapshot.
      needsDetail: !hasReconciliationFields(item),
    })),
    nextCursor,
  };
}

export function hasReconciliationFields(item: OlistApiOrder) {
  return typeof item.situacao === "number" && !!item.cliente && typeof item.cliente.nome === "string"
    && !!item.ecommerce && Object.hasOwn(item.ecommerce, "numeroPedidoEcommerce")
    && Object.hasOwn(item.ecommerce, "numeroPedidoCanalVenda")
    && Object.hasOwn(item, "transportador")
    && (!item.transportador || Object.hasOwn(item.transportador, "codigoRastreamento"));
}

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
    const response = await fetchTiny(`${API_BASE}/pedidos?limit=1`, { headers: { Authorization: `Bearer ${token}` } });
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
  ecommerceId,
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
      if (isNuvemshopOrder(item, ecommerceId)) allItems.set(item.id, item);
    }
  }

  // Keep the initial request short. Internal notes are resolved in batches by
  // the dedicated endpoint so a Vercel function never times out.
  return Array.from(allItems.values()).map(normalizeOlistOrder);
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
    return normalizeOlistOrder(detail);
  });
}

export function isNuvemshopOrder(item: OlistApiOrder, ecommerceId = Number(process.env.OLIST_NUVEMSHOP_ECOMMERCE_ID)) {
  if (!item.ecommerce) return false;
  const channelName = item.ecommerce.nome
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
  return ecommerceId > 0 ? item.ecommerce.id === ecommerceId : Boolean(channelName?.includes("nuvemshop"));
}

export function normalizeOlistOrder(item: OlistApiOrder): OlistOrder {
  return {
    id: item.id,
    yampiId: getYampiIdFromDetail(item),
    trackingCode: item.transportador?.codigoRastreamento || "",
    clientName: item.cliente?.nome || "",
    numeroPedido: item.numeroPedido || 0,
    dataCriacao: getCreationDate(item),
    situacao: item.situacao ?? null,
    ecommerceId: item.ecommerce?.id ?? null,
    ecommerceName: item.ecommerce?.nome || "",
    ecommerceOrderNumber: normalizeExternalReference(item.ecommerce?.numeroPedidoEcommerce) || null,
    ecommerceChannelOrderNumber: normalizeExternalReference(item.ecommerce?.numeroPedidoCanalVenda) || null,
  };
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
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(25_000)]) : AbortSignal.timeout(25_000);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { ...options, cache: "no-store", signal });
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
  const retry = response.headers.get("retry-after");
  let seconds = retry ? Number(retry) : NaN;
  if (retry && !Number.isFinite(seconds)) seconds = (Date.parse(retry) - Date.now()) / 1000;
  if (!retry) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    seconds = reset > 1e12 ? (reset - Date.now()) / 1000 : reset > 1e9 ? reset - Date.now() / 1000 : reset;
  }
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(3600, Math.ceil(seconds)) : 60;
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
