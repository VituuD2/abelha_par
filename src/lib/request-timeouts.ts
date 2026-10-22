// Include server authentication (20s), membership (10s) and the route's reads.
export const ACCESS_REQUEST_TIMEOUT_MS = 35_000;
export const ANALYTICS_REQUEST_TIMEOUT_MS = 50_000;

export function requestErrorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof Error && ["TimeoutError", "AbortError"].includes(reason.name))
    return "A resposta demorou mais que o esperado. Tente novamente em instantes.";
  if (reason instanceof TypeError)
    return "Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.";
  return reason instanceof Error ? reason.message : fallback;
}
