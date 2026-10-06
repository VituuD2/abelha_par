import "server-only";

const API = "https://api.tiny.com.br/public-api/v3";
export class AnalyticsApiError extends Error {
  constructor(
    public status: number,
    public retryAfter = 30,
  ) {
    super(
      status === 429
        ? "Limite da API Olist atingido; retomada programada."
        : status === 401
          ? "A autorização Olist foi recusada. Reconecte esta conta no Ninho."
          : status === 403
            ? "O aplicativo Olist não tem permissão para esta consulta. Confira as permissões e reconecte esta conta no Ninho."
            : `Consulta Olist indisponível (HTTP ${status}).`,
    );
  }
}
const slots = new Map<string, number>();
/** A DB sync lease serializes each account across instances; pacing also includes enrichment calls. */
export async function olistRequest(
  token: string,
  connectionId: string,
  path: string,
): Promise<Record<string, unknown>> {
  const now = Date.now(),
    next = Math.max(now, slots.get(connectionId) || 0);
  slots.set(connectionId, next + 2100);
  if (next > now)
    await new Promise((resolve) => setTimeout(resolve, next - now));
  let response: Response;
  try {
    response = await fetch(API + path, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new AnalyticsApiError(503);
  }
  if (!response.ok) {
    const retry = response.headers.get("retry-after");
    const seconds =
      retry && /^\d+$/.test(retry)
        ? Number(retry)
        : retry
          ? (Date.parse(retry) - Date.now()) / 1000
          : 30;
    throw new AnalyticsApiError(
      response.status,
      Math.min(3600, Math.max(3, Number.isFinite(seconds) ? seconds : 30)),
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (Array.isArray(body) && /^\/pedidos\/\d+\/marcadores$/.test(path))
    return { itens: body };
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("Resposta Olist inválida.");
  return body as Record<string, unknown>;
}
