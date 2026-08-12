import "server-only";

import type { OlistOrder } from "@/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchOlistOrders, OlistDateMode, resolveOlistOrders, TinyRateLimitError } from "@/lib/olist";
import { getValidTinyToken } from "@/lib/tiny-auth";

type CacheRow = {
  olist_order_id: number;
  yampi_id: string | null;
  tracking_code: string;
  client_name: string;
  numero_pedido: number | null;
  data_criacao: string | null;
  situacao: number | null;
};

type SyncJob = {
  id: string;
  owner_id: string;
  olist_order_id: number;
  attempts: number;
};

type StorageError = { code?: string; message?: string };

const MAX_JOB_BATCH = 10;

function fromCache(row: CacheRow): OlistOrder {
  return {
    id: row.olist_order_id,
    yampiId: row.yampi_id,
    trackingCode: row.tracking_code,
    clientName: row.client_name,
    numeroPedido: row.numero_pedido || 0,
    dataCriacao: row.data_criacao,
    situacao: row.situacao,
  };
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
    .select("olist_order_id, yampi_id, tracking_code, client_name, numero_pedido, data_criacao, situacao")
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
    ((cacheData || []) as CacheRow[]).map((row) => [row.olist_order_id, fromCache(row)])
  );
  const idsToResolve = forceRefresh
    ? uniqueIds
    : uniqueIds.filter((orderId) => !cache.has(orderId));

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
  const now = new Date().toISOString();
  const rows = uniqueIds.map((olistOrderId) => ({
    owner_id: ownerId,
    olist_order_id: olistOrderId,
    status: "queued",
    attempts: 0,
    requested_at: now,
    locked_at: null,
    completed_at: null,
    next_attempt_at: now,
    last_error: null,
  }));
  const { error } = refreshExisting
    ? await supabase.from("olist_sync_jobs").upsert(rows, { onConflict: "owner_id,olist_order_id" })
    : await supabase.from("olist_sync_jobs").upsert(rows, { onConflict: "owner_id,olist_order_id", ignoreDuplicates: true });
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

export async function processWebhookOrderNow(ownerId: string, orderId: number) {
  const supabase = createAdminClient();
  try {
    const token = await getValidTinyToken(ownerId);
    if (!token.token) throw new Error(token.message || "Conexão Tiny indisponível.");
    await resolveAndCacheOlistOrders(ownerId, token.token, [orderId], true);

    const completedAt = new Date().toISOString();
    const { error } = await supabase
      .from("olist_sync_jobs")
      .update({ status: "completed", completed_at: completedAt, locked_at: null, last_error: null })
      .eq("owner_id", ownerId)
      .eq("olist_order_id", orderId);
    if (error) throw new Error("Não foi possível concluir a sincronização recebida pelo webhook.");
    await supabase.from("olist_sync_state").upsert(
      { owner_id: ownerId, last_sync_at: completedAt, last_sync_error: null, updated_at: completedAt },
      { onConflict: "owner_id" }
    );
  } catch (error) {
    const retryAfterSeconds = error instanceof TinyRateLimitError ? error.retryAfterSeconds : 300;
    const message = error instanceof Error ? error.message.slice(0, 500) : "Falha na sincronização do webhook.";
    await supabase
      .from("olist_sync_jobs")
      .update({
        status: "failed",
        locked_at: null,
        next_attempt_at: new Date(Date.now() + retryAfterSeconds * 1000).toISOString(),
        last_error: message,
      })
      .eq("owner_id", ownerId)
      .eq("olist_order_id", orderId);
    throw error;
  }
}

export async function discoverUpdatedOrders(ownerId: string, dateFrom: string, dateTo = dateFrom) {
  const token = await getValidTinyToken(ownerId);
  if (!token.token) throw new Error(token.message || "Conexão Tiny indisponível.");

  const orders = await fetchOlistOrders({
    token: token.token,
    dateFrom,
    dateTo,
    dateMode: "updated" satisfies OlistDateMode,
  });
  await enqueueOlistOrders(ownerId, orders.map((order) => order.id));

  const now = new Date().toISOString();
  const { error } = await createAdminClient().from("olist_sync_state").upsert(
    { owner_id: ownerId, last_discovery_at: now, last_sync_error: null, updated_at: now },
    { onConflict: "owner_id" }
  );
  if (error) throw new Error("Não foi possível atualizar o cursor de sincronização.");
  return orders.length;
}

export async function discoverCurrentUpdatesForAllIntegrations() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from("tiny_integrations").select("owner_id").not("owner_id", "is", null);
  if (error) throw new Error("Não foi possível carregar as integrações Tiny.");

  const today = saoPauloDate();
  let discovered = 0;
  for (const row of data || []) {
    const ownerId = (row as { owner_id: string }).owner_id;
    try {
      const { data: syncState } = await supabase
        .from("olist_sync_state")
        .select("last_discovery_at")
        .eq("owner_id", ownerId)
        .maybeSingle();
      const lastDiscovery = syncState?.last_discovery_at
        ? new Date(syncState.last_discovery_at).getTime()
        : 0;
      // Webhooks enqueue the exact order immediately. This periodic discovery
      // is only a safety net, so one scan every 30 minutes is enough.
      if (Date.now() - lastDiscovery < 30 * 60 * 1000) continue;
      discovered += await discoverUpdatedOrders(ownerId, today);
    } catch (error) {
      await supabase.from("olist_sync_state").upsert(
        {
          owner_id: ownerId,
          last_sync_error: error instanceof Error ? error.message.slice(0, 500) : "Falha ao descobrir atualizações.",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "owner_id" }
      );
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
      const { error: completedError } = await supabase
        .from("olist_sync_jobs")
        .update({ status: "completed", completed_at: completedAt, locked_at: null, last_error: null })
        .in("id", ownerJobs.map((job) => job.id));
      if (completedError) throw new Error("Não foi possível concluir a fila de sincronização.");
      await supabase.from("olist_sync_state").upsert(
        { owner_id: ownerId, last_sync_at: completedAt, last_sync_error: null, updated_at: completedAt },
        { onConflict: "owner_id" }
      );
      completed += ownerJobs.length;
    } catch (error) {
      const retryAfterSeconds = error instanceof TinyRateLimitError ? error.retryAfterSeconds : 300;
      const message = error instanceof Error ? error.message.slice(0, 500) : "Falha na sincronização.";
      const nextAttemptAt = new Date(Date.now() + retryAfterSeconds * 1000).toISOString();
      await supabase
        .from("olist_sync_jobs")
        .update({ status: "failed", locked_at: null, next_attempt_at: nextAttemptAt, last_error: message })
        .in("id", ownerJobs.map((job) => job.id));
      await supabase.from("olist_sync_state").upsert(
        { owner_id: ownerId, last_sync_error: message, updated_at: new Date().toISOString() },
        { onConflict: "owner_id" }
      );
    }
  }
  return { claimed: jobs.length, completed };
}

function saoPauloDate() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
