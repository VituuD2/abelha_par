import "server-only";
import { createHash } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyticsToken, ensureAnalyticsIdentity } from "./auth";
import { compositionRulesForWorkspace, hasCompositionCatalog } from "./composition-server";
import { signedDecimalUnits, unitsDecimal } from "./engine";
import { object, string } from "./normalize";
import { AnalyticsApiError, AnalyticsQuotaWait, olistRequest } from "./olist-client";

export const costCents = (value: unknown) =>
  (typeof value === "string" || typeof value === "number") && /^-?\d+(?:\.\d{1,6})?$/.test(String(value))
    ? unitsDecimal(signedDecimalUnits(value, 6), 4) : null;

function effectiveDate(value: unknown) {
  const raw = string(value);
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(.*)$/.exec(raw);
  const normalized = br ? `${br[3]}-${br[2]}-${br[1]}${br[4]}` : raw;
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(normalized))
    throw new Error("Histórico Olist sem data de vigência válida.");
  const day = normalized.slice(0, 10);
  if (new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day ||
      (normalized.length > 10 && !Number.isFinite(Date.parse(normalized))))
    throw new Error("Data de vigência Olist inválida.");
  return normalized; // PostgreSQL interprets timezone-free provider dates in America/Sao_Paulo.
}

/** Import the whole paginated history, including the opening cost before the report period. */
export function normalizeCostHistoryPage(body: Record<string, unknown>, offset: number) {
  if (!Array.isArray(body.itens) || body.itens.length > 100)
    throw new Error("Histórico de custos Olist inválido.");
  const events = body.itens.map(value => {
    const raw = object(value), effective_at = effectiveDate(raw.data);
    const purchase_cents = costCents(raw.precoCusto), average_cents = costCents(raw.custoMedio);
    const event_key = createHash("sha256").update(JSON.stringify([
      effective_at, purchase_cents, average_cents, string(raw.saldoAnterior), string(raw.saldoAtual), string(raw.impostosRecuperaveis),
    ])).digest("hex");
    return { event_key, effective_at, purchase_cents, average_cents, raw };
  });
  const total = object(body.paginacao).total;
  if (total !== undefined && (!Number.isSafeInteger(Number(total)) || Number(total) < offset + body.itens.length))
    throw new Error("Paginação do histórico Olist inválida.");
  const done = total !== undefined ? offset + body.itens.length >= Number(total) : body.itens.length < 100;
  if (!body.itens.length && !done) throw new Error("Histórico Olist vazio antes da última página.");
  return { events: [...new Map(events.map(event => [event.event_key, event])).values()], count: body.itens.length, done };
}

export async function queueCostHistory(workspace: string, force = false) {
  if (!hasCompositionCatalog(workspace)) return;
  const rules = compositionRulesForWorkspace(workspace);
  const targets = [...new Set([...Object.values(rules.rules).map(rule => rule.target),
    ...Object.values(rules.bundles).flatMap(bundle => bundle.components.map(component => component.target))])];
  const result = await createAdminClient().rpc("analytics_queue_cost_history", { p_workspace: workspace, p_skus: targets, p_force: force });
  if (result.error) throw new Error("Não foi possível programar o histórico de CMV. Confira a migração v19.");
}

type HistoryJob = { external_id: string; scan_id: string; page_offset: number; attempts: number };
export async function processCostHistorySync(): Promise<{ claimed: boolean; processed: number; pending?: boolean; error?: string }> {
  const db = createAdminClient(), started = Date.now();
  const claim = await db.rpc("analytics_claim_cost_history");
  if (claim.error) return { claimed: true, processed: 0, error: "Histórico do CMV indisponível. Confira a migração v19." };
  if (!claim.data) return { claimed: false, processed: 0 };
  const batch = claim.data, jobs = batch.jobs as HistoryJob[];
  const scope = { p_workspace: batch.workspace_id, p_connection: batch.connection_id, p_lease: batch.lease, p_version: batch.connection_version };
  let current: HistoryJob | undefined, processed = 0, cooldown = 3;
  try {
    const token = await analyticsToken(batch.workspace_id, batch.connection_id);
    await ensureAnalyticsIdentity(batch.workspace_id, batch.connection_id, token);
    for (const job of jobs) {
      if (Date.now() - started > 8000) break; // Leave room for one provider timeout and the sales workers.
      current = job;
      const params = new URLSearchParams({ limit: "100", offset: String(job.page_offset) });
      const page = normalizeCostHistoryPage(await olistRequest(token, batch.connection_id, `/produtos/${job.external_id}/custos?${params}`, { source: "costs" }), job.page_offset);
      const saved = await db.rpc("analytics_finish_cost_history_page", { ...scope,
        p_external: job.external_id, p_scan: job.scan_id, p_offset: job.page_offset,
        p_count: page.count, p_events: page.events, p_done: page.done,
      });
      if (saved.error) throw new Error("O checkpoint do histórico mudou; retomada necessária.");
      processed += page.count;
    }
    return { claimed: true, processed, pending: true };
  } catch (reason) {
    if (reason instanceof AnalyticsQuotaWait) {
      const deferred = await db.rpc("analytics_defer_cost", { ...scope, p_kind: "history", p_seconds: reason.retryAfter,
        p_external: current?.external_id || null });
      if (!deferred.error) return { claimed: true, processed, pending: true };
      if (!["PGRST202", "42883"].includes(deferred.error.code))
        return { claimed: true, processed, pending: true, error: "Não foi possível persistir a espera do histórico de CMV." };
    }
    const permission = reason instanceof AnalyticsApiError && reason.status === 403;
    const message = permission ? "Libere a consulta de histórico de custos/Produtos na Olist 1 e reconecte essa conta no Ninho."
      : reason instanceof Error ? reason.message : "Falha na importação do histórico de CMV.";
    const retry = reason instanceof AnalyticsApiError ? (permission || reason.status === 401 ? 3600 : reason.retryAfter)
      : Math.min(3600, 30 * 2 ** Math.min(current?.attempts || 0, 7));
    if (reason instanceof AnalyticsApiError && reason.status === 429) cooldown = retry;
    for (const job of current ? [current] : jobs)
      await db.rpc("analytics_finish_cost_history_page", { ...scope, p_external: job.external_id, p_scan: job.scan_id,
        p_offset: job.page_offset, p_error: message, p_retry: retry });
    return { claimed: true, processed, pending: true, error: message };
  } finally {
    await db.rpc("analytics_release_cost_history", { p_workspace: batch.workspace_id, p_connection: batch.connection_id,
      p_lease: batch.lease, p_cooldown: cooldown });
  }
}
