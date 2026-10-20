import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { saoPauloDate } from "@/lib/dates";
import { analyticsToken, ensureAnalyticsIdentity } from "./auth";
import { AnalyticsApiError, olistRequest } from "./olist-client";
import { id, normalizeOrder, nullable, object, orderItemProductId, string } from "./normalize";
import type { ABCFilters, SyncJob } from "./types";
import { AnalyticsActionError } from "./sync-errors";

class YieldBatch extends Error {}
const tomorrow = (day: string) =>
  new Date(Date.parse(day + "T12:00:00Z") + 86400000)
    .toISOString()
    .slice(0, 10);
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
  const db = createAdminClient(),
    today = saoPauloDate();
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
  const db = createAdminClient(),
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
  if (!job) return { processed: 0, pending: false };
  if (workspace && job.workspace_id !== workspace)
    throw new Error("Reserva analítica fora do workspace autorizado.");
  const lease = job.lease_token;
  let processed = 0;
  let failed = false;
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
      throw new Error("A reserva da importação mudou; retomada necessária.");
    Object.assign(job, patch);
  };
  try {
    const token = await analyticsToken(job.workspace_id, job.connection_id);
    await ensureAnalyticsIdentity(job.workspace_id, job.connection_id, token);
    const query = async (path: string) => {
      if (Date.now() - started > budgetMs - 12000) throw new YieldBatch();
      return olistRequest(token, job.connection_id, path);
    };
    const productCache = new Map<string, Record<string, unknown>>();
    // Small pages and empty days should not waste the rest of a cron invocation.
    while (true) {
      if (!job.pending_ids.length) {
        const params = new URLSearchParams({
          limit: "100",
          offset: String(job.page_offset),
          orderBy: "asc",
        });
        if (job.mode === "incremental" && job.query_phase !== "sales")
          params.set("dataAtualizacao", job.cursor_date);
        else {
          params.set("dataInicial", job.cursor_date);
          params.set("dataFinal", job.cursor_date);
        }
        const listing = await query("/pedidos?" + params);
        if (!Array.isArray(listing.itens))
          throw new Error("Listagem de pedidos Olist inválida.");
        const ids = listing.itens.map((v) => id(object(v).id));
        const pagination = object(listing.paginacao),
          total = Number(pagination.total);
        const done = Number.isFinite(total)
          ? job.page_offset + listing.itens.length >= total
          : listing.itens.length < 100;
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
        const raw = await query("/pedidos/" + id(job.pending_ids[index]));
        const fetchedAt = new Date().toISOString();
        if (id(raw.id) !== id(job.pending_ids[index]))
          throw new Error("A Olist retornou outro pedido.");
        if (Number(raw.situacao) === 2) {
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
          });
          continue;
        }
        const ecommerce = object(raw.ecommerce),
          sourceKey =
            string(ecommerce.id) ||
            `direct:${string(raw.origemPedido) || "unknown"}`;
        const src = await db
          .from("analytics_sources")
          .upsert(
            {
              workspace_id: job.workspace_id,
              connection_id: job.connection_id,
              external_id: sourceKey,
              name: string(ecommerce.nome) || "Sem integração identificada",
              channel: nullable(ecommerce.canalVenda),
            },
            { onConflict: "workspace_id,connection_id,external_id" },
          )
          .select("id")
          .single();
        if (src.error)
          throw new Error("Não foi possível salvar a origem da venda.");
        const products: Record<string, Record<string, unknown>> = {};
        if (!Array.isArray(raw.itens))
          throw new Error("Pedido sem itens no detalhe Olist.");
        for (const [position, value] of raw.itens.entries()) {
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
        let invoice: Record<string, unknown> | undefined,
          tags: unknown[] | undefined;
        if (raw.idNotaFiscal && string(raw.idNotaFiscal) !== "0") {
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
        }
        try {
          const markers = await query("/pedidos/" + id(raw.id) + "/marcadores");
          tags = Array.isArray(markers.itens)
            ? markers.itens
            : Array.isArray(markers.marcadores)
              ? markers.marcadores
              : [];
        } catch (reason) {
          if (!(
            reason instanceof AnalyticsApiError &&
            [403, 404].includes(reason.status)
          ))
            throw reason;
        }
        const normalized = normalizeOrder(
          raw,
          job.connection_id,
          src.data.id,
          fetchedAt,
          products,
          invoice,
          tags,
        );
        if (!tags)
          normalized.order.quality_flags.push("marcadores_indisponiveis");
        if (raw.idNotaFiscal && !invoice)
          normalized.order.quality_flags.push("nota_nao_validada");
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
        });
      }
      if (job.pending_index >= job.pending_ids.length) {
        // A scan by update date alone cannot prove that all sales from a day exist.
        // New incrementals scan sales first, then changes/cancellations for that day.
        if (job.mode === "incremental" && job.query_phase === "sales" && job.page_done) {
          await checkpoint({ query_phase: "updates", page_offset: 0, pending_ids: [], pending_index: 0, page_done: false });
          continue;
        }
        if (job.page_done && job.cursor_date >= job.to_date) {
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
          });
          return { processed, pending: false };
        }
        await checkpoint({
          cursor_date: job.page_done
            ? tomorrow(job.cursor_date)
            : job.cursor_date,
          page_offset: job.page_done ? 0 : job.page_offset + 100,
          pending_ids: [],
          pending_index: 0,
          ...(job.mode === "incremental" && job.page_done && job.covers_sales
            ? { query_phase: "sales" } : {}),
        });
      }
    }
  } catch (reason) {
    failed = !(reason instanceof YieldBatch);
    const yielded = reason instanceof YieldBatch;
    const errorCode = reason instanceof AnalyticsActionError ? reason.code
      : reason instanceof AnalyticsApiError && reason.status === 401 ? "authorization_required"
      : reason instanceof AnalyticsApiError && reason.status === 403 ? "permission_required" : null;
    const delay = yielded
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
    await checkpoint({
      status: yielded ? "queued" : errorCode ? "failed" : "retry",
      error_code: errorCode,
      attempts: yielded ? job.attempts : job.attempts + 1,
      next_at: new Date(Date.now() + delay * 1000).toISOString(),
      last_error: message,
      lease_token: null,
      lease_until: null,
    });
    if (message)
      await db
        .from("analytics_connections")
        .update({ last_error: message, error_code: errorCode })
        .eq("workspace_id", job.workspace_id)
        .eq("id", job.connection_id);
    return { processed, pending: true, error: message };
  } finally {
    await db
      .from("analytics_connections")
      .update({
        sync_lock: null, sync_locked_until: null,
        ...(processed > 0 ? { last_synced_at: new Date().toISOString() } : {}),
        ...(!failed ? { last_error: null, error_code: null } : {}),
      })
      .eq("workspace_id", job.workspace_id)
      .eq("id", job.connection_id)
      .eq("sync_lock", lease);
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
    ...(errors.length ? { error: errors.join(" ") } : {}),
  };
}
