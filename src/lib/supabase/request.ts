// Shared by the Node server and edge middleware. Never log query strings or credentials.
export const AUTH_TIMEOUT_MS = 20_000;
export const MEMBERSHIP_TIMEOUT_MS = 10_000;
export const STATUS_TIMEOUT_MS = 8_000;

export function createSupabaseFetch(timeoutMs: number): typeof fetch {
  return async (input, options) => {
    const started = Date.now();
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const callerSignal = options?.signal ?? (input instanceof Request ? input.signal : null);
    const signal = callerSignal
      ? AbortSignal.any([callerSignal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs);
    let response: Response | undefined;
    try {
      response = await fetch(input, { ...options, signal });
      return response;
    } catch (reason) {
      // PostgREST retries TimeoutError as a network error. AbortError stops the
      // SDK from repeating an already expired read with another full timeout.
      if (signal.aborted) throw new DOMException("Consulta Supabase cancelada ou com tempo limite excedido.", "AbortError");
      throw reason;
    } finally {
      const elapsedMs = Date.now() - started;
      if (!response || !response.ok || elapsedMs >= 3_000) {
        console.warn(JSON.stringify({ event: "supabase_request", path: url.pathname,
          method: options?.method || (input instanceof Request ? input.method : "GET"),
          status: response?.status ?? null, elapsedMs,
          aborted: signal.aborted, requestId: response?.headers.get("sb-request-id") ?? null }));
      }
    }
  };
}
