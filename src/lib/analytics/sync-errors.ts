export class AnalyticsActionError extends Error {
  constructor(
    public code: "authorization_required" | "identity_mismatch" | "permission_required",
    message: string,
  ) {
    super(message);
  }
}

/** Preserve diagnostic codes without leaking provider messages, SQL, tokens or row data. */
export function analyticsDatabaseError(message: string, error: { code?: string }, status?: number) {
  const code = /^[A-Za-z0-9_]{1,64}$/.test(error.code || "") ? error.code! : "unavailable";
  return new AnalyticsDatabaseError(`${message} [banco: ${code}${status ? `; HTTP ${status}` : ""}]`, code);
}
export class AnalyticsDatabaseError extends Error {
  constructor(message: string, public databaseCode: string) { super(message); }
}
