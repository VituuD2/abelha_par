import "server-only";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export class OlistBudgetExceeded extends Error {}
export class OlistQuotaWait extends Error {
  constructor(public retryAfterSeconds: number) { super("Cota de consultas Olist reservada; retomada programada."); }
}
export type OlistScope = { connectionId?: string; workspaceId?: string };
export type OlistSource = "orders" | "costs" | "operational" | "identity";
type Permit = { id: string | null; waitMs: number };
const fallbackSlots = new Map<string, number>();
let missingUntil = 0;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** No acceleration before v23 is installed. Unknown/unbound setup calls keep the old pace. */
async function fallback(scope: OlistScope, deadline: number, timeout: number): Promise<Permit> {
  const key = scope.connectionId || scope.workspaceId || "unbound";
  const now = Date.now(), next = Math.max(now, fallbackSlots.get(key) || 0);
  if (next + timeout > deadline) throw new OlistBudgetExceeded();
  fallbackSlots.set(key, next + 2100);
  if (next > now) await sleep(next - now);
  return { id: null, waitMs: next - now };
}

export async function acquireOlistPermit(scope: OlistScope, source: OlistSource, retry: boolean,
  deadline = Date.now() + 18000, timeout = 10000): Promise<Permit> {
  if ((!scope.connectionId && !scope.workspaceId) || missingUntil > Date.now()) return fallback(scope, deadline, timeout);
  const id = randomUUID(), started = Date.now();
  while (true) {
    if (Date.now() + timeout > deadline) throw new OlistBudgetExceeded();
    const result = await createAdminClient().rpc("olist_api_acquire", {
      p_request: id, p_source: source, p_retry: retry,
      p_connection: scope.connectionId || null, p_workspace: scope.workspaceId || null,
    }).abortSignal(AbortSignal.timeout(2000));
    if (result.error) {
      if (["PGRST202", "42883"].includes(result.error.code)) {
        missingUntil = Date.now() + 60000;
        console.warn("[olist-api] v23 ausente; mantendo o ritmo conservador e sem métricas persistidas.");
        return fallback(scope, deadline, timeout);
      }
      throw new Error("Controle de consultas Olist indisponível; chamada adiada para preservar a cota.");
    }
    const gate = result.data;
    if (gate?.granted === true) return { id, waitMs: Date.now() - started };
    const waitMs = Number(gate?.wait_ms);
    if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error("Controle de consultas Olist inválido.");
    if (Date.now() + waitMs + timeout > deadline) throw new OlistQuotaWait(Math.max(1, Math.ceil(waitMs / 1000)));
    await sleep(Math.max(20, waitMs));
  }
}

const headerInteger = (headers: Headers | undefined, name: string, max = 10000) => {
  const raw = headers?.get(name);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= max ? value : null;
};
export async function recordOlistResult(permit: Permit, status: number, durationMs: number,
  kind: "http" | "timeout" | "network", headers?: Headers, retryAfter?: number) {
  if (!permit.id) return;
  try {
    const result = await createAdminClient().rpc("olist_api_record", {
      p_request: permit.id, p_status: status, p_duration: Math.max(0, Math.round(durationMs)), p_kind: kind,
      p_limit: headerInteger(headers, "x-ratelimit-limit"),
      p_remaining: headerInteger(headers, "x-ratelimit-remaining"),
      // The v3 contract defines reset as seconds remaining, not an epoch timestamp.
      p_reset: headerInteger(headers, "x-ratelimit-reset", 3600),
      p_retry_after: retryAfter ?? null,
    }).abortSignal(AbortSignal.timeout(2000));
    if (result.error) throw new Error("record failed");
  } catch {
    // A successful provider read must not be repeated because its telemetry failed.
    console.warn("[olist-api] Resultado não confirmado no monitor; tentativa permanece contabilizada.");
  }
}

export async function olistApiUsage(workspace: string, actor: string) {
  const result = await createAdminClient().rpc("olist_api_usage", { p_workspace: workspace, p_actor: actor, p_minutes: 60 })
    .abortSignal(AbortSignal.timeout(3000));
  if (result.error) return { available: false, error: ["PGRST202", "42883"].includes(result.error.code)
    ? "Aplique a migração v23 para ativar os limites por conta e o monitor de consumo."
    : "Não foi possível atualizar o consumo. Tente novamente." };
  return result.data;
}
