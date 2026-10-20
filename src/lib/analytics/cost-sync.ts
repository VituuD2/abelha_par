import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyticsToken, ensureAnalyticsIdentity } from "./auth";
import { decimalUnits, unitsDecimal } from "./engine";
import { id, object, string } from "./normalize";
import { AnalyticsApiError, olistRequest } from "./olist-client";
import { createHash } from "crypto";
import { queueCostHistory } from "./cost-history-sync";

export async function costSyncStatus(workspace: string) {
  const db = createAdminClient();
  const [result, history] = await Promise.all([db.from("analytics_cost_sync")
    .select("connection_id,page_offset,last_synced_at,last_error,next_at,updated_at")
    .eq("workspace_id", workspace).maybeSingle(),
    db.rpc("analytics_cost_history_status", { p_workspace: workspace }),
  ]);
  if (result.error) return { last_error: "Sincronização de CMV indisponível. Confira a migração v18." };
  return result.data ? { ...result.data, history: history.data,
    ...(history.error ? { last_error: "Histórico de custos indisponível. Confira a migração v19." } : {}) } : null;
}

/** The list endpoint includes costs: one request for 100 products, no detail fan-out. */
export function normalizeCostPage(body: Record<string, unknown>, offset: number) {
  if (!Array.isArray(body.itens) || body.itens.length > 100)
    throw new Error("Listagem de custos Olist inválida.");
  const products = body.itens.map(value => {
    const product = object(value), prices = object(product.precos);
    const raw = prices.precoCusto;
    let cost: string | null = null;
    if ((typeof raw === "string" || typeof raw === "number") && /^\d+(?:\.\d{1,6})?$/.test(String(raw)))
      cost = unitsDecimal(decimalUnits(raw, 6), 4); // BRL -> cents, preserving sub-cent costs.
    const sku = string(product.sku).toUpperCase();
    if (sku.length > 200) throw new Error("SKU Olist excede 200 caracteres.");
    const provider_revision = createHash("sha256").update(JSON.stringify([
      string(product.dataAlteracao), string(prices.precoCusto), string(prices.precoCustoMedio),
    ])).digest("hex");
    return { external_id: id(product.id), sku: sku || null, cost_cents: cost, active: !!sku && product.situacao !== "E", provider_revision };
  });
  if (new Set(products.map(product => product.external_id)).size !== products.length)
    throw new Error("Listagem Olist contém produtos repetidos.");
  const total = object(body.paginacao).total;
  if (total !== undefined && (!Number.isSafeInteger(Number(total)) || Number(total) < offset + products.length))
    throw new Error("Paginação de custos Olist inválida.");
  const done = total !== undefined ? offset + products.length >= Number(total) : products.length < 100;
  if (!products.length && !done) throw new Error("Página Olist vazia antes do fim do catálogo.");
  return { products, done };
}

/** Same distributed account lease as order imports; safe across concurrent cron invocations. */
export async function processCostSync(): Promise<{ processed: number; pending?: boolean; error?: string }> {
  const db = createAdminClient();
  const claim = await db.rpc("analytics_claim_cost_sync");
  if (claim.error) return { processed: 0, error: "Sincronização de CMV indisponível. Confira a migração v18." };
  if (!claim.data) return { processed: 0 };
  const job = claim.data;
  const args = {
    p_workspace: job.workspace_id, p_connection: job.connection_id,
    p_lease: job.lease, p_version: job.connection_version, p_offset: job.page_offset,
  };
  try {
    const token = await analyticsToken(job.workspace_id, job.connection_id);
    await ensureAnalyticsIdentity(job.workspace_id, job.connection_id, token);
    const params = new URLSearchParams({ limit: "100", offset: String(job.page_offset) });
    const page = normalizeCostPage(await olistRequest(token, job.connection_id, `/produtos?${params}`), job.page_offset);
    const saved = await db.rpc("analytics_finish_cost_page", { ...args, p_products: page.products, p_done: page.done });
    if (saved.error) throw new Error("A reserva de custos mudou; a página será retomada.");
    await queueCostHistory(job.workspace_id);
    return { processed: page.products.length, pending: !page.done };
  } catch (reason) {
    const permission = reason instanceof AnalyticsApiError && reason.status === 403;
    const message = permission
      ? "Libere a leitura de Produtos no aplicativo da Olist 1 e reconecte essa conta no Ninho para atualizar o CMV."
      : reason instanceof Error ? reason.message : "Falha ao sincronizar o CMV da Olist 1.";
    const retry = reason instanceof AnalyticsApiError
      ? (reason.status === 401 || permission ? 3600 : reason.retryAfter)
      : Math.min(3600, 30 * 2 ** Math.min(Number(job.attempts) || 0, 7));
    const failed = await db.rpc("analytics_finish_cost_page", {
      ...args, p_error: message, p_retry: retry,
      p_cooldown: reason instanceof AnalyticsApiError && reason.status === 429 ? retry : 3,
    });
    return { processed: 0, error: message, ...(failed.error ? { pending: true } : {}) };
  }
}
