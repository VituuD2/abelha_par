import "server-only";

import type { OlistOrder } from "@/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOlistOrdersPage, resolveOlistOrders, TinyRateLimitError } from "@/lib/olist";
import { getValidTinyToken } from "@/lib/tiny-auth";
import { getReconciliationConfig } from "@/lib/reconciliation-config";
import { saoPauloDate } from "@/lib/dates";

type CacheRow = {
  olist_order_id: number;
  yampi_id: string | null;
  tracking_code: string;
  client_name: string;
  numero_pedido: number | null;
  data_criacao: string | null;
  situacao: number | null;
  ecommerce_id: number | null;
  ecommerce_name: string | null;
  ecommerce_order_number: string | null;
  ecommerce_channel_order_number: string | null;
  resolved_at: string;
};

type SyncJob = {
  id: string;
  owner_id: string;
  olist_order_id: number;
  attempts: number;
  lock_token: string;
};

type StorageError = { code?: string; message?: string };

const MAX_JOB_BATCH = 5;

export const OLIST_CACHE_FIELDS = "olist_order_id, yampi_id, tracking_code, client_name, numero_pedido, data_criacao, situacao, ecommerce_id, ecommerce_name, ecommerce_order_number, ecommerce_channel_order_number, resolved_at";

export function fromOlistCache(row: CacheRow): OlistOrder {
  return {
    id: row.olist_order_id,
    yampiId: row.yampi_id,
    trackingCode: row.tracking_code,
    clientName: row.client_name,
    numeroPedido: row.numero_pedido || 0,
    dataCriacao: row.data_criacao,
    situacao: row.situacao,
    ecommerceId: row.ecommerce_id,
    ecommerceName: row.ecommerce_name || "",
    ecommerceOrderNumber: row.ecommerce_order_number,
    ecommerceChannelOrderNumber: row.ecommerce_channel_order_number,
  };
}

/** Only call with provider-derived records, never with client-supplied order data. */
export async function cacheOlistOrders(ownerId: string, orders: OlistOrder[]) {
  const complete = orders.filter(order => !order.needsDetail);
  if (!complete.length) return;
  const now = new Date().toISOString();
  const { error } = await createAdminClient().from("olist_order_cache").upsert(complete.map(order => ({
    owner_id: ownerId,
    olist_order_id: order.id,
    yampi_id: order.yampiId,
    tracking_code: order.trackingCode.slice(0, 200),
    client_name: order.clientName.slice(0, 300),
    numero_pedido: order.numeroPedido || null,
    data_criacao: order.dataCriacao,
    situacao: order.situacao,
    ecommerce_id: order.ecommerceId,
    ecommerce_name: order.ecommerceName,
    ecommerce_order_number: order.ecommerceOrderNumber,
    ecommerce_channel_order_number: order.ecommerceChannelOrderNumber,
    resolved_at: now,
    updated_at: now,
  })), { onConflict: "owner_id,olist_order_id" });
  if (error) throw new Error("Não foi possível salvar os pedidos Olist para a conferência.");
}

export async function resolveAndCacheOlistOrders(
  ownerId: string,
  token: string,
  orderIds: number[],
  forceRefresh = false
): Promise<OlistOrder[]> {
  const uniqueIds = Array.from(new Set(orderIds));
  if (uniqueIds.length === 0) return [];

  const supabase = createAdminClient();
  const { data: cacheData, error: cacheError } = await supabase
    .from("olist_order_cache")
    .select(OLIST_CACHE_FIELDS)
    .eq("owner_id", ownerId)
    .in("olist_order_id", uniqueIds);
  const cacheAvailable = !cacheError;
  if (cacheError && !isMissingCacheStorageError(cacheError)) {
    throw new Error("Não foi possível ler o cache de pedidos.");
  }
  if (cacheError) {
    // The cache was introduced after the initial integration schema. Do not
    // block the operator's current work if a deployment reached Vercel before
    // its optional cache migration was executed.
    console.warn("[olist-sync] order cache unavailable; resolving without cache", {
      code: cacheError.code,
      message: cacheError.message,
    });
  }

  const cache = new Map(
    ((cacheData || []) as CacheRow[]).map((row) => [row.olist_order_id, fromOlistCache(row)])
  );
  const resolvedTimes = new Map(((cacheData || []) as CacheRow[]).map(row => [row.olist_order_id, Date.parse(row.resolved_at)]));
  // A tracking code may be generated after the order was first cached. Empty
  // codes are therefore an incomplete cache entry, never a final result.
  const idsToResolve = forceRefresh
    ? uniqueIds
    : uniqueIds.filter((orderId) => {
        const cachedOrder = cache.get(orderId);
        return !cachedOrder || !cachedOrder.trackingCode.trim() || !cachedOrder.ecommerceId || Date.now() - (resolvedTimes.get(orderId) || 0) > 5 * 60_000;
      });

  if (idsToResolve.length > 0) {
    const resolved = await resolveOlistOrders(token, idsToResolve);
    const now = new Date().toISOString();
    const { error: upsertError } = cacheAvailable ? await supabase.from("olist_order_cache").upsert(
      resolved.map((order) => ({
        owner_id: ownerId,
        olist_order_id: order.id,
        yampi_id: order.yampiId,
        tracking_code: order.trackingCode.slice(0, 200),
        client_name: order.clientName.slice(0, 300),
        numero_pedido: order.numeroPedido || null,
        data_criacao: order.dataCriacao,
        situacao: order.situacao,
        ecommerce_id: order.ecommerceId,
        ecommerce_name: order.ecommerceName,
        ecommerce_order_number: order.ecommerceOrderNumber,
        ecommerce_channel_order_number: order.ecommerceChannelOrderNumber,
        resolved_at: now,
        updated_at: now,
      })),
      { onConflict: "owner_id,olist_order_id" }
    ) : { error: null };
    if (upsertError && !isMissingCacheStorageError(upsertError)) {
      throw new Error("Não foi possível atualizar o cache de pedidos.");
    }
    for (const order of resolved) cache.set(order.id, order);
  }

  return uniqueIds.map((orderId) => cache.get(orderId)).filter((order): order is OlistOrder => Boolean(order));
}

function isMissingCacheStorageError(error: StorageError) {
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /olist_order_cache/i.test(error.message || "") && /(does not exist|not find|schema cache)/i.test(error.message || "");
}

export async function enqueueOlistOrders(
  ownerId: string,
  orderIds: number[],
  refreshExisting = false
) {
  const uniqueIds = Array.from(new Set(orderIds)).filter((id) => Number.isInteger(id) && id > 0);
  if (uniqueIds.length === 0) return 0;

  const supabase = createAdminClient();
  const { error } = await supabase.rpc("enqueue_olist_sync_jobs", { p_owner: ownerId, p_ids: uniqueIds, p_refresh: refreshExisting });
  if (error) throw new Error("Não foi possível enfileirar os pedidos Olist.");
  return uniqueIds.length;
}

export async function recordWebhook(ownerId: string) {
  const now = new Date().toISOString();
  const { error } = await createAdminClient().from("olist_sync_state").upsert(
    { owner_id: ownerId, last_webhook_at: now, updated_at: now },
    { onConflict: "owner_id" }
  );
  if (error) throw new Error("Não foi possível registrar o webhook.");
}

/** One provider page per invocation; checkpointed so a timeout cannot skip a day. */
export async function discoverCurrentUpdatesForAllIntegrations() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("tiny_integrations").select("owner_id").not("owner_id", "is", null);
  if (error) throw new Error("Não foi possível carregar as integrações Tiny.");
  const today = saoPauloDate();
  let discovered = 0;
  // This installation has one account. Bound work to keep the cron under its runtime limit.
  for (const row of (data || []).slice(0, 5)) {
    const ownerId = row.owner_id as string;
    try {
      const { data: checkpoint, error: checkpointError } = await supabase.from("olist_sync_state").select("last_discovery_at, discovery_day, discovery_offset").eq("owner_id", ownerId).maybeSingle();
      if (checkpointError) throw new Error("Atualize a estrutura da fila Olist no banco.");
      const fallback = checkpoint?.last_discovery_at ? saoPauloDate(new Date(checkpoint.last_discovery_at)) : saoPauloDate(new Date(Date.now() - 86_400_000));
      const day = checkpoint?.discovery_day || fallback;
      if (day === today && Date.now() - Date.parse(checkpoint?.last_discovery_at || "") < 30 * 60_000 && !checkpoint?.discovery_offset) continue;
      const token = await getValidTinyToken(ownerId);
      if (!token.token) throw new Error(token.message || "Conexão Tiny indisponível.");
      const page = await fetchOlistOrdersPage({ token: token.token, dateFrom: day, dateTo: day, dateMode: "updated", ecommerceId: getReconciliationConfig()?.ecommerceId, cursor: { day: 0, offset: checkpoint?.discovery_offset || 0 } });
      await cacheOlistOrders(ownerId, page.orders);
      await enqueueOlistOrders(ownerId, page.orders.filter(order => order.needsDetail).map(order => order.id), true);
      const nextDay = day < today ? saoPauloDate(new Date(new Date(`${day}T12:00:00-03:00`).getTime() + 86_400_000)) : day;
      const now = new Date().toISOString();
      const { error: savedError } = await supabase.from("olist_sync_state").upsert({ owner_id: ownerId, discovery_day: page.nextCursor ? day : nextDay, discovery_offset: page.nextCursor?.offset || 0, last_discovery_at: now, last_sync_error: null, updated_at: now }, { onConflict: "owner_id" });
      if (savedError) throw new Error("Não foi possível atualizar o cursor Olist.");
      discovered += page.orders.length;
    } catch (error) {
      await supabase.from("olist_sync_state").upsert({ owner_id: ownerId, last_sync_error: error instanceof Error ? error.message.slice(0, 500) : "Falha ao consultar atualizações.", updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
    }
  }
  return discovered;
}

export async function processQueuedOlistOrders(limit = MAX_JOB_BATCH) {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("claim_olist_sync_jobs", { job_limit: Math.min(limit, MAX_JOB_BATCH) });
  if (error) throw new Error("Não foi possível reservar a fila de sincronização.");

  const jobs = (data || []) as SyncJob[];
  const jobsByOwner = new Map<string, SyncJob[]>();
  for (const job of jobs) {
    const ownerJobs = jobsByOwner.get(job.owner_id) || [];
    ownerJobs.push(job);
    jobsByOwner.set(job.owner_id, ownerJobs);
  }

  let completed = 0;
  for (const [ownerId, ownerJobs] of jobsByOwner) {
    const ids = ownerJobs.map((job) => job.olist_order_id);
    try {
      const token = await getValidTinyToken(ownerId);
      if (!token.token) throw new Error(token.message || "Conexão Tiny indisponível.");

      await resolveAndCacheOlistOrders(ownerId, token.token, ids, true);
      const completedAt = new Date().toISOString();
      for (const job of ownerJobs) {
        const { error: completedError } = await supabase.rpc("finish_olist_sync_job", { p_id: job.id, p_lock: job.lock_token });
        if (completedError) throw new Error("Não foi possível concluir a fila de sincronização.");
      }
      await supabase.from("olist_sync_state").upsert(
        { owner_id: ownerId, last_sync_at: completedAt, last_sync_error: null, updated_at: completedAt },
        { onConflict: "owner_id" }
      );
      completed += ownerJobs.length;
    } catch (error) {
      const retryAfterSeconds = error instanceof TinyRateLimitError ? error.retryAfterSeconds : 300;
      const message = error instanceof Error ? error.message.slice(0, 500) : "Falha na sincronização.";
      for (const job of ownerJobs) await supabase.rpc("finish_olist_sync_job", { p_id: job.id, p_lock: job.lock_token, p_error: message, p_retry: retryAfterSeconds });
      await supabase.from("olist_sync_state").upsert(
        { owner_id: ownerId, last_sync_error: message, updated_at: new Date().toISOString() },
        { onConflict: "owner_id" }
      );
    }
  }
  return { claimed: jobs.length, completed };
}
