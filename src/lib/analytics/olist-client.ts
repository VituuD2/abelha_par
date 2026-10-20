import "server-only";
import { acquireOlistPermit, recordOlistResult, OlistBudgetExceeded, OlistQuotaWait, type OlistSource } from "@/lib/olist-api-control";
export { OlistBudgetExceeded as AnalyticsBudgetExceeded } from "@/lib/olist-api-control";

const API = "https://api.tiny.com.br/public-api/v3";
export class AnalyticsApiError extends Error {
  constructor(
    public status: number,
    public retryAfter = 30,
    public kind: "http" | "timeout" | "network" = "http",
  ) {
    super(
      status === 429
        ? "Limite da API Olist atingido; retomada programada."
        : status === 401
          ? "A autorização Olist foi recusada. Reconecte esta conta no Ninho."
          : status === 403
            ? "O aplicativo Olist não tem permissão para esta consulta. Confira as permissões e reconecte esta conta no Ninho."
            : kind === "http" ? `Consulta Olist indisponível (HTTP ${status}).`
              : `Consulta Olist indisponível (${kind === "timeout" ? "tempo limite excedido" : "falha de rede"}; retomada programada).`,
    );
  }
}
export type OlistAttempt = { status: number; kind: "http" | "timeout" | "network"; elapsedMs: number; waitMs: number; retry: boolean };
type RequestOptions = {
  source?: OlistSource;
  deadlineMs?: number;
  retryTransient?: boolean;
  onAttempt?: (attempt: OlistAttempt) => void;
};
/** A DB sync lease serializes each account across instances; pacing also includes enrichment calls. */
export async function olistRequest(
  token: string,
  connectionId: string,
  path: string,
  options: RequestOptions = {},
): Promise<Record<string, unknown>> {
  // Retries are opt-in for workers with an explicit deadline. Never retry writes or OAuth.
  const deadline = options.deadlineMs ?? Infinity;
  let notBefore = 0;
  let previousFailure: AnalyticsApiError | undefined;
  for (let attempt = 0; ; attempt++) {
    const now = Date.now(), next = Math.max(now, notBefore);
    if (next + 10_000 > deadline) throw previousFailure || new OlistBudgetExceeded();
    let waitMs = next - now;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    const source = path === "/info" ? "identity" : options.source || "orders";
    const permit = await acquireOlistPermit({ connectionId }, source, attempt > 0, Number.isFinite(deadline) ? deadline : Date.now() + 18000)
      .catch(reason => {
        if (previousFailure && reason instanceof OlistBudgetExceeded) throw previousFailure;
        if (reason instanceof OlistQuotaWait) throw new AnalyticsApiError(429, reason.retryAfterSeconds);
        throw reason;
      });
    waitMs += permit.waitMs;
    if (Date.now() + 10_000 > deadline) throw previousFailure || new OlistBudgetExceeded();
    const started = Date.now();
    let failure: AnalyticsApiError | undefined, retryHeader: string | null = null;
    let response: Response | undefined, body: unknown;
    try {
      response = await fetch(API + path, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        try { body = await response.json(); }
        catch (reason) { if (!(reason instanceof SyntaxError)) throw reason; }
      } else {
        const retry = retryHeader = response.headers.get("retry-after");
        const reset = response.headers.get("x-ratelimit-reset");
        const seconds = retry && /^\d+$/.test(retry) ? Number(retry)
          : retry ? (Date.parse(retry) - Date.now()) / 1000
          : response.status === 429 && /^\d+$/.test(reset || "") ? Number(reset) : 30;
        failure = new AnalyticsApiError(response.status,
          Math.min(3600, Math.max(3, Number.isFinite(seconds) ? seconds : 30)));
        await response.body?.cancel();
      }
    } catch (reason) {
      failure ??= new AnalyticsApiError(503, 30,
        reason instanceof Error && ["TimeoutError", "AbortError"].includes(reason.name) ? "timeout" : "network");
    }
    options.onAttempt?.({ status: failure?.status ?? response!.status, kind: failure?.kind ?? "http",
      elapsedMs: Date.now() - started, waitMs, retry: attempt > 0 });
    await recordOlistResult(permit, failure?.status ?? response!.status, Date.now() - started,
      failure?.kind ?? "http", response?.headers, failure?.status === 429 ? failure.retryAfter : undefined);
    if (failure) {
      // One extra GET at most, still paced. Long Retry-After/429 go to the durable queue.
      const retryAt = retryHeader ? Date.now() + failure.retryAfter * 1000
        : Date.now() + 500 + Math.floor(Math.random() * 500);
      const nextAttempt = retryAt;
      if (options.retryTransient && Number.isFinite(deadline) && attempt === 0
        && [502, 503, 504].includes(failure.status) && nextAttempt + 10_000 <= deadline) {
        notBefore = retryAt;
        previousFailure = failure;
        continue;
      }
      throw failure;
    }
    if (Array.isArray(body) && /^\/pedidos\/\d+\/marcadores$/.test(path)) return { itens: body };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Resposta Olist inválida.");
    return body as Record<string, unknown>;
  }
}
