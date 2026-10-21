import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { saoPauloDate } from "@/lib/dates";
import { analyticsToken, ensureAnalyticsIdentity } from "./auth";
import { AnalyticsApiError, AnalyticsQuotaWait, AnalyticsBudgetExceeded as YieldBatch, olistRequest, type OlistAttempt } from "./olist-client";
import { id, normalizeOrder, nullable, object, orderItemProductId, string } from "./normalize";
import type { ABCFilters, SyncJob } from "./types";
import { AnalyticsActionError, AnalyticsDatabaseError, analyticsDatabaseError } from "./sync-errors";
import { dayAfter, initialScan, listingPage, orderMarkers, reusableStage, stageOrder, type OrderStage } from "./import-plan";
import { OlistControlError } from "@/lib/olist-api-control";

export async function enqueueSync(
  workspace: string,
  connection: string,
  from: string,
  to: string,
  mode: "backfill" | "incremental" = "backfill",
) {
  const db = createAdminClient();
  const existing = await db
    .from("analytics_connections")
    .select("id")
    .eq("workspace_id", workspace)
    .eq("id", connection)
    .eq("enabled", true)
    .maybeSingle();
  if (existing.error || !existing.data)
    throw new Error("Conexão não autorizada ou pausada.");
  const { error } = await db.rpc("analytics_schedule_range", {
    p_workspace: workspace, p_connection: connection,
    p_from: from, p_to: to, p_mode: mode,
  });
  if (error)
    throw new Error(
      "Não foi possível programar a importação. Confira a migração v12.",
    );
}
/** Only the server's authenticated scope can schedule missing history. */
export async function ensureFilterCoverage(workspace: string, actor: string, filters: ABCFilters) {
  const { data, error } = await createAdminClient().rpc("analytics_ensure_coverage", {
    p_workspace: workspace, p_actor: actor, p_filters: filters,
  });
  if (error) throw new Error("Não foi possível programar o histórico faltante. Confira a migração v12 e a rotina analítica.");
  return data;
}
export async function enqueueIncremental() {
  const db = createAdminClient(5000),
    today = saoPauloDate();
  const recent = await db.rpc("analytics_schedule_recent");
  if (recent.error && !["PGRST202", "42883"].includes(recent.error.code))
    throw analyticsDatabaseError("Não foi possível programar pedidos recentes.", recent.error);
  const { data, error } = await db
    .from("analytics_connections")
    .select("id,workspace_id,last_synced_at,incremental_through")
    .eq("enabled", true)
    .not("last_synced_at", "is", null);
  if (error) throw new Error("Camada analítica indisponível.");
  for (const c of data || []) {
    const active = await db
      .from("analytics_sync_jobs")
      .select("id")
      .eq("workspace_id", c.workspace_id)
      .eq("connection_id", c.id)
      .eq("mode", "incremental")
      .in("status", ["queued", "running", "retry", "failed"])
      .limit(1);
    if (active.error)
      throw new Error("Não foi possível verificar os checkpoints.");
    if (active.data?.length) continue;
    // Overlap two São Paulo calendar days; late events are harmless upserts.
    let watermark = c.incremental_through;
    if (!watermark) {
      const history = await db
        .from("analytics_sync_jobs")
        .select("created_at,to_date")
        .eq("workspace_id", c.workspace_id)
        .eq("connection_id", c.id)
        .eq("mode", "backfill")
        .order("created_at")
        .limit(1);
      if (history.error)
        throw new Error("Não foi possível consultar o início do histórico.");
      watermark = saoPauloDate(
        new Date(history.data?.[0]?.created_at || c.last_synced_at),
      );
      // Also fetch sales from the days between a historical end and its completion.
      if (history.data?.[0]?.to_date && history.data[0].to_date < watermark)
        watermark = history.data[0].to_date;
    }
    const from = new Date(Date.parse(watermark + "T12:00:00Z") - 86400000)
      .toISOString()
      .slice(0, 10);
    await enqueueSync(c.workspace_id, c.id, from, today, "incremental");
  }
}
export async function processAnalyticsBatch(
  workspace?: string,
  budgetMs = 40000,
  reserved?: SyncJob,
) {
  const db = createAdminClient(5000),
    started = Date.now();
  let candidate = reserved;
  if (!candidate) {
    const { data, error } = await db.rpc("analytics_claim_job", {
      p_workspace: workspace || null,
    });
    if (error) throw new Error("Não foi possível reservar a importação analítica.");
    candidate = data?.[0];
  }
  const job = candidate;
  if (!job) return { processed: 0, pending: false, outcome: "idle" };
  if (workspace && job.workspace_id !== workspace)
    throw new Error("Reserva analítica fora do workspace autorizado.");
  const lease = job.lease_token;
  let processed = 0;
  let failed = false;
  let outcome = "completed", stage = "authorization", endpoint: string | null = null;
  let failureKind: string | null = null, failureCode: string | number | null = null, nextAt: string | null = null;
  let context: { historyFrom: string; creationThrough: string; connectionVersion: number } | null = null;
  const resumable = job.import_state !== undefined;
  const metrics = { apiRequests: 0, apiMs: 0, pacingMs: 0, retries: 0, transientFailures: 0, timeouts: 0, networkFailures: 0, sourceCacheHits: 0, stageCacheHits: 0, inlineMarkers: 0 };
  const onAttempt = (attempt: OlistAttempt) => {
    metrics.apiRequests++;
    metrics.apiMs += attempt.elapsedMs;
    metrics.pacingMs += attempt.waitMs;
    if (attempt.retry) metrics.retries++;
    if (attempt.status >= 500) metrics.transientFailures++;
    if (attempt.kind === "timeout") metrics.timeouts++;
    if (attempt.kind === "network") metrics.networkFailures++;
  };
  const checkpoint = async (patch: Record<string, unknown>) => {
    const result = await db
      .from("analytics_sync_jobs")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("workspace_id", job.workspace_id)
      .eq("id", job.id)
      .eq("lease_token", lease)
      .gt("lease_until", new Date().toISOString())
      .select("id")
      .maybeSingle();
    if (result.error || !result.data)
      throw analyticsDatabaseError("A reserva da importação mudou; retomada necessária.", result.error || { code: "LEASE_CHANGED" });
    Object.assign(job, patch);
  };
  try {
    const token = await analyticsToken(job.workspace_id, job.connection_id);
    stage = "identity";
    await ensureAnalyticsIdentity(job.workspace_id, job.connection_id, token);
    if (resumable) {
      stage = "context";
      const result = await db.rpc("analytics_import_context", { p_job: job.id, p_lease: lease });
      if (result.error) throw analyticsDatabaseError("Não foi possível consultar o contexto da importação v24.", result.error);
      context = result.data;
      if (!context?.historyFrom || !context.creationThrough || !Number.isInteger(context.connectionVersion))
        throw new Error("Contexto da importação inválido.");
    }
    const query = async (path: string) => {
      endpoint = path.split("?")[0].replace(/\/\d+/g, "/:id");
      if (Date.now() - started > budgetMs - 12000) throw new YieldBatch();
      return olistRequest(token, job.connection_id, path, {
        deadlineMs: started + budgetMs - 2000,
        retryTransient: true,
        onAttempt,
      });
    };
    const productCache = new Map<string, Record<string, unknown>>();
    const sourceCache = new Map<string, { fingerprint: string; id: string }>();
    // Small pages and empty days should not waste the rest of a cron invocation.
    while (true) {
      if (!job.pending_ids.length) {
        // Upgrade at a page boundary. A stored pending page is always drained first.
        if (context && job.mode === "incremental" && !job.import_state?.scan) {
          const nextSale = !job.covers_sales ? job.from_date : job.query_phase === "updates" ? dayAfter(job.cursor_date) : job.cursor_date;
          const updates = nextSale > job.to_date;
          await checkpoint({ import_state: { ...job.import_state, scan: initialScan(job, context.historyFrom, context.creationThrough), order: null },
            query_phase: updates ? "updates" : "sales", cursor_date: updates ? job.to_date : nextSale,
            ...(job.query_phase !== "sales" || !job.covers_sales ? { page_offset: 0, page_done: false } : {}), covers_sales: true });
        }
        const params = new URLSearchParams({
          limit: "100",
          offset: String(job.page_offset),
          orderBy: job.lane === "recent" ? "desc" : "asc",
        });
        if (job.mode === "incremental" && job.query_phase !== "sales") {
          const scan = job.import_state?.scan;
          params.set("dataAtualizacao", scan?.since || job.cursor_date);
          if (scan) { params.set("dataInicial", scan.from); params.set("dataFinal", scan.to); }
        }
        else {
          params.set("dataInicial", job.cursor_date);
          params.set("dataFinal", job.cursor_date);
        }
        stage = "listing";
        const listing = await query("/pedidos?" + params);
        const { entries, done } = listingPage(listing, job.page_offset);
        const ids = entries.map((v) => id(object(v).id));
        if (new Set(ids).size !== ids.length) throw new Error("Listagem de pedidos com IDs repetidos.");
        await checkpoint({
          pending_ids: ids,
          pending_index: 0,
          page_done: done,
          pages: job.pages + 1,
        });
      }
      for (
        let index = job.pending_index;
        index < job.pending_ids.length;
        index++
      ) {
        stage = "detail";
        const externalId = id(job.pending_ids[index]);
        const cached = job.import_state?.order;
        let orderStage: OrderStage;
        if (context && reusableStage(cached, externalId, context.connectionVersion)) {
          orderStage = cached!; metrics.stageCacheHits++;
        } else {
          const detail = await query("/pedidos/" + externalId);
          if (id(detail.id) !== externalId) throw new Error("A Olist retornou outro pedido.");
          const inlineTags = orderMarkers(detail.marcadores);
          if (inlineTags !== undefined) metrics.inlineMarkers++;
          orderStage = { externalId, fetchedAt: new Date().toISOString(), connectionVersion: context?.connectionVersion || 0,
            raw: stageOrder(detail), ...(inlineTags !== undefined ? { tags: inlineTags, tagsChecked: true } : {}) };
          if (resumable) await checkpoint({ import_state: { ...job.import_state, order: orderStage } });
        }
        const raw = orderStage.raw, fetchedAt = orderStage.fetchedAt;
        if (id(raw.id) !== id(job.pending_ids[index]))
          throw new Error("A Olist retornou outro pedido.");
        if (Number(raw.situacao) === 2) {
          stage = "cancellation";
          const cancelled = await db.rpc("analytics_cancel_order", {
            p_job: job.id,
            p_lease: lease,
            p_external: id(raw.id),
            p_fetched: fetchedAt,
          });
          if (cancelled.error)
            throw new Error(
              "Não foi possível atualizar o cancelamento da venda.",
            );
          processed++;
          await checkpoint({
            pending_index: index + 1,
            processed: job.processed + 1,
            attempts: 0,
            last_error: null,
            ...(resumable ? { import_state: { ...job.import_state, order: null } } : {}),
          });
          continue;
        }
        const ecommerce = object(raw.ecommerce),
          sourceKey =
            string(ecommerce.id) ||
            `direct:${string(raw.origemPedido) || "unknown"}`;
        const source = {
          workspace_id: job.workspace_id,
          connection_id: job.connection_id,
          external_id: sourceKey,
          name: string(ecommerce.nome) || "Sem integração identificada",
          channel: nullable(ecommerce.canalVenda),
        };
        const sourceCacheKey = JSON.stringify(source);
        stage = "source";
        const cachedSource = sourceCache.get(sourceKey);
        let sourceId = cachedSource?.fingerprint === sourceCacheKey ? cachedSource.id : undefined;
        if (sourceId) metrics.sourceCacheHits++;
        else {
          const src = await db
            .from("analytics_sources")
            .upsert(source, { onConflict: "workspace_id,connection_id,external_id" })
            .select("id")
            .single();
          if (src.error) throw analyticsDatabaseError("Não foi possível salvar a origem da venda.", src.error);
          sourceId = src.data.id as string;
          sourceCache.set(sourceKey, { fingerprint: sourceCacheKey, id: sourceId });
        }
        const products: Record<string, Record<string, unknown>> = {};
        if (!Array.isArray(raw.itens))
          throw new Error("Pedido sem itens no detalhe Olist.");
        for (const [position, value] of raw.itens.entries()) {
          stage = "product_cache";
          const product = object(object(value).produto),
            productId = orderItemProductId(product.id, raw.id, position);
          // Zero/missing id is an actual unlinked order line, never a catalog id.
          // Keep its real amounts; normalizeOrder gives it a scoped identity and warning.
          if (productId.startsWith("order:")) continue;
          if (products[productId]) continue;
          const inBatch = productCache.get(productId);
          if (inBatch) {
            products[productId] = inBatch;
            continue;
          }
          const cached = await db
            .from("analytics_products")
            .select("*")
            .eq("workspace_id", job.workspace_id)
            .eq("connection_id", job.connection_id)
            .eq("external_id", productId)
            .maybeSingle();
          if (cached.error)
            throw new Error("Não foi possível consultar o cadastro analítico.");
          if (
            cached.data &&
            Math.max(
              Date.parse(cached.data.enriched_at || "") || 0,
              Date.parse(cached.data.enrichment_checked_at || "") || 0,
            ) >
              Date.now() - 86400000 * 7
          ) {
            const c = cached.data;
            products[productId] = {
              id: c.enriched_at ? productId : null,
              __enriched_at: c.enriched_at,
              descricao: c.name,
              sku: c.sku,
              produtoPai: c.parent_id
                ? { id: c.parent_id, descricao: c.parent_name }
                : null,
              gtin: c.gtin,
              categoria: { nome: c.category },
              marca: { nome: c.brand },
            };
            productCache.set(productId, products[productId]);
            continue;
          }
          try {
            stage = "product";
            const p = await query("/produtos/" + productId);
            if (id(p.id) !== productId)
              throw new Error("Cadastro Olist incompatível.");
            products[productId] = p;
            const parent = object(p.produtoPai);
            let parentId: string | null = null;
            try {
              parentId = id(parent.id);
            } catch {
              /* No documented parent relation. */
            }
            // Persist enrichment independently: a large order resumes without refetching its products.
            const saved = await db.from("analytics_products").upsert(
              {
                workspace_id: job.workspace_id,
                connection_id: job.connection_id,
                external_id: productId,
                name:
                  string(p.descricao || product.descricao) ||
                  `Produto ${productId}`,
                sku: nullable(p.sku || product.sku),
                parent_id: parentId,
                parent_name: nullable(parent.descricao),
                gtin: nullable(p.gtin),
                category: nullable(
                  object(p.categoria).caminhoCompleto || object(p.categoria).nome,
                ),
                brand: nullable(object(p.marca).nome),
                enriched_at: new Date().toISOString(),
                enrichment_error: null,
              },
              { onConflict: "workspace_id,connection_id,external_id" },
            );
            if (saved.error)
              throw new Error("Não foi possível salvar o cadastro do produto.");
            productCache.set(productId, p);
          } catch (reason) {
            if (!(reason instanceof AnalyticsApiError && [403, 404].includes(reason.status)))
              throw reason;
            const saved = await db.from("analytics_products").upsert(
              {
                workspace_id: job.workspace_id,
                connection_id: job.connection_id,
                external_id: productId,
                name: string(product.descricao) || `Produto ${productId}`,
                sku: nullable(product.sku),
                enrichment_checked_at: new Date().toISOString(),
                enrichment_error: reason.status === 404
                  ? "Produto não encontrado no catálogo Olist; dados do item preservados."
                  : "Permissão de leitura de produtos indisponível.",
              },
              { onConflict: "workspace_id,connection_id,external_id" },
            );
            if (saved.error)
              throw new Error(
                "Não foi possível registrar a pendência do cadastro.",
              );
            products[productId] = { id: null, descricao: string(product.descricao), sku: nullable(product.sku) };
            productCache.set(productId, products[productId]);
          }
        }
        let invoice: Record<string, unknown> | undefined = orderStage.invoice || undefined;
        let tags: unknown[] | undefined = orderStage.tagsChecked ? orderStage.tags : orderMarkers(raw.marcadores);
        if (tags !== undefined && !orderStage.tagsChecked) metrics.inlineMarkers++;
        if (raw.idNotaFiscal && string(raw.idNotaFiscal) !== "0" && !orderStage.invoiceChecked) {
          stage = "invoice";
          try {
            invoice = await query("/notas/" + id(raw.idNotaFiscal));
            if (id(invoice.id) !== id(raw.idNotaFiscal))
              throw new Error("A Olist retornou outra nota fiscal.");
          } catch (reason) {
            if (!(
              reason instanceof AnalyticsApiError &&
              [403, 404].includes(reason.status)
            ))
              throw reason;
          }
          orderStage = { ...orderStage, invoice: invoice ? {
            id: invoice.id, situacao: invoice.situacao, tipo: invoice.tipo, finalidade: invoice.finalidade, dataEmissao: invoice.dataEmissao,
          } : null, invoiceChecked: true };
          if (resumable) await checkpoint({ import_state: { ...job.import_state, order: orderStage } });
        }
        if (tags === undefined && !orderStage.tagsChecked) try {
          stage = "markers";
          const markers = await query("/pedidos/" + id(raw.id) + "/marcadores");
          tags = orderMarkers(markers.itens ?? markers.marcadores);
          if (tags === undefined) throw new Error("Marcadores Olist inválidos.");
        } catch (reason) {
          if (!(
            reason instanceof AnalyticsApiError &&
            [403, 404].includes(reason.status)
          ))
            throw reason;
        }
        if (!orderStage.tagsChecked) {
          orderStage = { ...orderStage, tags, tagsChecked: true };
          if (resumable) await checkpoint({ import_state: { ...job.import_state, order: orderStage } });
        }
        stage = "normalization";
        const normalized = normalizeOrder(
          raw,
          job.connection_id,
          sourceId,
          fetchedAt,
          products,
          invoice,
          tags,
        );
        if (!tags)
          normalized.order.quality_flags.push("marcadores_indisponiveis");
        if (raw.idNotaFiscal && !invoice)
          normalized.order.quality_flags.push("nota_nao_validada");
        stage = "ingestion";
        const ingested = await db.rpc("analytics_ingest", {
          p_job: job.id,
          p_lease: job.lease_token,
          p_order: normalized.order,
          p_items: normalized.items,
        });
        if (ingested.error)
          throw new Error(
            ingested.error.code === "23514" && /analytics_items_(unit_price|gross_cents)_check/.test(ingested.error.message || "")
              ? `Pedido Olist ${raw.id}: o banco ainda bloqueia valores negativos de itens. Aplique a migração v20 para preservar os valores da Olist e retome este checkpoint.`
              : ingested.error.code === "23514" && /analytics_orders_total_cents_check/.test(ingested.error.message || "")
                ? `Pedido Olist ${raw.id}: o banco ainda bloqueia totais negativos. Aplique a migração v21 e retome este checkpoint.`
            : ingested.error.message?.includes("IDENTITY_CHANGED")
              ? "Identidade externa alterada. Requer reconciliação administrativa antes de importar."
              : "Não foi possível gravar o pedido analítico atomicamente.",
          );
        processed++;
        await checkpoint({
          pending_index: index + 1,
          processed: job.processed + 1,
          attempts: 0,
          last_error: null,
          ...(resumable ? { import_state: { ...job.import_state, order: null } } : {}),
        });
      }
      if (job.pending_index >= job.pending_ids.length) {
        if (context && job.mode === "incremental" && job.query_phase !== "sales" && !job.import_state?.scan) {
          const nextSale = job.covers_sales ? dayAfter(job.cursor_date) : job.from_date;
          await checkpoint({ import_state: { ...job.import_state, scan: initialScan(job, context.historyFrom, context.creationThrough), order: null },
            query_phase: nextSale > job.to_date ? "updates" : "sales", cursor_date: nextSale > job.to_date ? job.to_date : nextSale,
            pending_ids: [], pending_index: 0, page_offset: 0, page_done: false, covers_sales: true });
          continue;
        }
        const scan = job.import_state?.scan;
        if (scan && job.mode === "incremental" && job.page_done) {
          if (job.query_phase === "sales" && job.cursor_date >= job.to_date) {
            await checkpoint({ query_phase: "updates", page_offset: 0, pending_ids: [], pending_index: 0, page_done: false });
            continue;
          }
          if (job.query_phase === "updates" && scan.to < scan.ceiling) {
            const from = dayAfter(scan.to);
            await checkpoint({ import_state: { ...job.import_state, scan: { ...scan, from,
              to: [dayAfter(from, scan.days - 1), scan.ceiling].sort()[0] } },
              page_offset: 0, pending_ids: [], pending_index: 0, page_done: false });
            continue;
          }
        }
        // A scan by update date alone cannot prove that all sales from a day exist.
        // New incrementals scan sales first, then changes/cancellations for that day.
        if (!scan && job.mode === "incremental" && job.query_phase === "sales" && job.page_done) {
          await checkpoint({ query_phase: "updates", page_offset: 0, pending_ids: [], pending_index: 0, page_done: false });
          continue;
        }
        const rangeDone = job.lane === "recent" ? job.cursor_date <= job.from_date : job.cursor_date >= job.to_date;
        if (job.page_done && rangeDone && (!scan || job.query_phase === "updates")) {
          if (resumable) {
            stage = "completion";
            const finished = await db.rpc("analytics_finish_import", { p_job: job.id, p_lease: lease });
            if (finished.error) throw analyticsDatabaseError("Não foi possível concluir a importação atomicamente.", finished.error);
            return { processed, pending: false, outcome: "completed" };
          }
          const saved = await db
            .from("analytics_connections")
            .update({
              last_synced_at: new Date().toISOString(),
              last_error: null,
              error_code: null,
              ...(job.mode === "incremental"
                ? { incremental_through: job.to_date }
                : {}),
            })
            .eq("workspace_id", job.workspace_id)
            .eq("id", job.connection_id)
            .eq("sync_lock", lease);
          if (saved.error)
            throw new Error(
              "Importação concluída, mas atualização do status pendente.",
            );
          await checkpoint({
            status: "completed",
            pending_ids: [],
            pending_index: 0,
            lease_token: null,
            lease_until: null,
            last_error: null,
            ...(resumable ? { import_state: { ...job.import_state, order: null } } : {}),
          });
          return { processed, pending: false, outcome: "completed" };
        }
        await checkpoint({
          cursor_date: job.page_done
            ? dayAfter(job.cursor_date, job.lane === "recent" ? -1 : 1)
            : job.cursor_date,
          page_offset: job.page_done ? 0 : job.page_offset + 100,
          pending_ids: [],
          pending_index: 0,
          ...(!scan && job.mode === "incremental" && job.page_done && job.covers_sales
            ? { query_phase: "sales" } : {}),
        });
      }
    }
  } catch (reason) {
    const yielded = reason instanceof YieldBatch;
    const quotaWait = reason instanceof AnalyticsQuotaWait;
    failed = !yielded && !quotaWait;
    outcome = yielded ? "budget_wait" : quotaWait ? "quota_wait" : "retryable_error";
    failureKind = yielded ? "budget" : quotaWait ? "quota" : reason instanceof AnalyticsApiError ? reason.kind
      : reason instanceof AnalyticsActionError ? "authorization" : reason instanceof OlistControlError ? "quota_control"
      : reason instanceof AnalyticsDatabaseError || ["source", "product_cache", "ingestion", "cancellation", "completion"].includes(stage) ? "database"
      : ["normalization", "listing", "detail", "markers"].includes(stage) ? "validation" : "internal";
    failureCode = quotaWait ? "local_quota" : reason instanceof AnalyticsApiError ? reason.status
      : reason instanceof AnalyticsDatabaseError ? reason.databaseCode
      : reason instanceof AnalyticsActionError || reason instanceof OlistControlError ? reason.code : null;
    const errorCode = reason instanceof AnalyticsActionError ? reason.code
      : reason instanceof AnalyticsApiError && reason.status === 401 ? "authorization_required"
      : reason instanceof AnalyticsApiError && reason.status === 403 ? "permission_required" : null;
    if (errorCode) outcome = "action_required";
    let delay = yielded
      ? 1
      : reason instanceof AnalyticsApiError
        ? reason.retryAfter
        : Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7));
    const message = yielded
      ? null
      : errorCode === "authorization_required" && reason instanceof AnalyticsApiError
        ? "A Olist recusou a autorização. Reconecte esta conta no Ninho; o checkpoint será preservado."
      : errorCode === "permission_required"
        ? "Libere a leitura de pedidos e informações da conta no aplicativo Olist e reconecte no Ninho."
      : reason instanceof Error
        ? reason.message
        : "Falha na importação.";
    // A selective update listing can be split further without skipping any IDs.
    const scan = job.import_state?.scan;
    const split = stage === "listing" && job.query_phase === "updates" && scan && scan.from < scan.to
      && reason instanceof AnalyticsApiError && (reason.kind === "timeout" || reason.status === 400);
    if (split) delay = 1;
    nextAt = new Date(Date.now() + delay * 1000).toISOString();
    try {
      await checkpoint({
        status: yielded || quotaWait ? "queued" : errorCode ? "failed" : "retry",
        error_code: errorCode,
        attempts: yielded || quotaWait ? job.attempts : job.attempts + 1,
        next_at: nextAt,
        last_error: yielded || quotaWait ? null : message,
        lease_token: null,
        lease_until: null,
        ...(split ? { import_state: { ...job.import_state, scan: { ...scan, days: 1, to: scan.from } }, page_offset: 0 } : {}),
      });
    } catch (persistenceError) {
      failed = true; outcome = "persistence_error"; failureKind = "database";
      failureCode = persistenceError instanceof AnalyticsDatabaseError ? persistenceError.databaseCode : null;
      throw persistenceError;
    }
    if (message && !quotaWait)
      await db
        .from("analytics_connections")
        .update({ last_error: message, error_code: errorCode })
        .eq("workspace_id", job.workspace_id)
        .eq("id", job.connection_id);
    return { processed, pending: true, outcome, nextAt, error: yielded || quotaWait ? null : message };
  } finally {
    let releaseError: Error | null = null;
    try {
      const released = await db
        .from("analytics_connections")
        .update({
          sync_lock: null, sync_locked_until: null,
          ...(processed > 0 ? { last_synced_at: new Date().toISOString() } : {}),
          ...(!failed ? { last_error: null, error_code: null } : {}),
        })
        .eq("workspace_id", job.workspace_id)
        .eq("id", job.connection_id)
        .eq("sync_lock", lease);
      if (released.error) releaseError = analyticsDatabaseError("Não foi possível liberar a reserva analítica.", released.error);
    } catch {
      releaseError = analyticsDatabaseError("Não foi possível liberar a reserva analítica.", { code: "unavailable" });
    }
    if (releaseError) { failed = true; outcome = "persistence_error"; failureKind = "database"; stage = "release"; }
    console.info(JSON.stringify({ event: "analytics_import_batch", jobId: job.id, connectionId: job.connection_id,
      mode: job.mode, lane: job.lane || "history", processed, failed, outcome, stage, endpoint,
      failureKind, failureCode, nextAt, queryPhase: job.query_phase, partitionFrom: job.import_state?.scan?.from,
      partitionTo: job.import_state?.scan?.to, elapsedMs: Date.now() - started, ...metrics }));
    if (releaseError) throw releaseError;
  }
}

/** Reserve up to three distinct accounts, then give each its own bounded worker. */
export async function processAnalyticsBatches(workspace?: string, budgetMs = 40000) {
  const started = Date.now();
  const { data, error } = await createAdminClient().rpc("analytics_claim_jobs", {
    p_workspace: workspace || null, p_limit: 3,
  });
  if (error) throw new Error("Não foi possível reservar as contas analíticas. Confira a migração v13.");
  const jobs: SyncJob[] = data || [];
  const results = await Promise.allSettled(jobs.map((job) =>
    processAnalyticsBatch(workspace, Math.max(0, budgetMs - (Date.now() - started)), job),
  ));
  const completed = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const errors = completed.flatMap((result) => result.error ? [result.error] : []);
  if (results.some((result) => result.status === "rejected"))
    errors.push("Um lote não concluiu; o checkpoint será retomado após a reserva vencer.");
  return {
    processed: completed.reduce((total, result) => total + result.processed, 0),
    pending: results.some((result) => result.status === "rejected" || result.value.pending),
    accounts: jobs.length,
    outcomes: results.map((result, index) => ({ connectionId: jobs[index]?.connection_id,
      outcome: result.status === "fulfilled" ? result.value.outcome : "persistence_error",
      processed: result.status === "fulfilled" ? result.value.processed : 0 })),
    ...(errors.length ? { error: errors.join(" ") } : {}),
  };
}
