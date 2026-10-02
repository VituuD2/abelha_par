import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { saoPauloDate } from "@/lib/dates";
import { analyticsToken, ensureAnalyticsIdentity } from "./auth";
import { AnalyticsApiError, olistRequest } from "./olist-client";
import { id, normalizeOrder, nullable, object, string } from "./normalize";
import type { SyncJob } from "./types";

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
  const { error } = await db.from("analytics_sync_jobs").insert({
    workspace_id: workspace,
    connection_id: connection,
    mode,
    from_date: from,
    to_date: to,
    cursor_date: from,
  });
  if (error && error.code !== "23505")
    throw new Error(
      "Não foi possível programar a importação. Confira a migração v11.",
    );
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
      .eq("connection_id", c.id)
      .in("status", ["queued", "running", "retry"])
      .limit(1);
    if (active.error)
      throw new Error("Não foi possível verificar os checkpoints.");
    if (active.data?.length) continue;
    // Overlap two São Paulo calendar days; late events are harmless upserts.
    let watermark = c.incremental_through;
    if (!watermark) {
      const history = await db
        .from("analytics_sync_jobs")
        .select("created_at")
        .eq("workspace_id", c.workspace_id)
        .eq("connection_id", c.id)
        .eq("mode", "backfill")
        .eq("status", "completed")
        .order("created_at")
        .limit(1);
      if (history.error)
        throw new Error("Não foi possível consultar o início do histórico.");
      watermark = saoPauloDate(
        new Date(history.data?.[0]?.created_at || c.last_synced_at),
      );
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
) {
  const db = createAdminClient(),
    started = Date.now();
  const { data, error } = await db.rpc("analytics_claim_job", {
    p_workspace: workspace || null,
  });
  if (error)
    throw new Error("Não foi possível reservar a importação analítica.");
  const job: SyncJob | undefined = data?.[0];
  if (!job) return { processed: 0, pending: false };
  const lease = job.lease_token;
  let processed = 0;
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
    if (!job.pending_ids.length) {
      const params = new URLSearchParams({
        limit: "100",
        offset: String(job.page_offset),
        orderBy: "asc",
      });
      if (job.mode === "incremental")
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
      for (const value of raw.itens) {
        const product = object(object(value).produto),
          productId = id(product.id);
        if (products[productId]) continue;
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
          Date.parse(
            cached.data.enriched_at || cached.data.enrichment_checked_at || "",
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
        } catch (reason) {
          if (!(reason instanceof AnalyticsApiError && reason.status === 403))
            throw reason;
          const saved = await db.from("analytics_products").upsert(
            {
              workspace_id: job.workspace_id,
              connection_id: job.connection_id,
              external_id: productId,
              name: string(product.descricao) || `Produto ${productId}`,
              sku: nullable(product.sku),
              enrichment_checked_at: new Date().toISOString(),
              enrichment_error:
                "Permissão de leitura de produtos indisponível.",
            },
            { onConflict: "workspace_id,connection_id,external_id" },
          );
          if (saved.error)
            throw new Error(
              "Não foi possível registrar a pendência do cadastro.",
            );
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
          ingested.error.message?.includes("IDENTITY_CHANGED")
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
      if (job.page_done && job.cursor_date >= job.to_date) {
        const saved = await db
          .from("analytics_connections")
          .update({
            last_synced_at: new Date().toISOString(),
            last_error: null,
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
      });
    }
    await checkpoint({
      status: "queued",
      lease_token: null,
      lease_until: null,
    });
    return { processed, pending: true };
  } catch (reason) {
    const yielded = reason instanceof YieldBatch;
    const delay = yielded
      ? 1
      : reason instanceof AnalyticsApiError
        ? reason.retryAfter
        : Math.min(3600, 30 * 2 ** Math.min(job.attempts, 7));
    const message = yielded
      ? null
      : reason instanceof Error
        ? reason.message
        : "Falha na importação.";
    await checkpoint({
      status: yielded ? "queued" : job.attempts >= 9 ? "failed" : "retry",
      attempts: yielded ? job.attempts : job.attempts + 1,
      next_at: new Date(Date.now() + delay * 1000).toISOString(),
      last_error: message,
      lease_token: null,
      lease_until: null,
    });
    if (message)
      await db
        .from("analytics_connections")
        .update({ last_error: message })
        .eq("workspace_id", job.workspace_id)
        .eq("id", job.connection_id);
    return { processed, pending: true, error: message };
  } finally {
    await db
      .from("analytics_connections")
      .update({ sync_lock: null, sync_locked_until: null })
      .eq("workspace_id", job.workspace_id)
      .eq("id", job.connection_id)
      .eq("sync_lock", lease);
  }
}
