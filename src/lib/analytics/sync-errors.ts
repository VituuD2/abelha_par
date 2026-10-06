export class AnalyticsActionError extends Error {
  constructor(
    public code: "authorization_required" | "identity_mismatch" | "permission_required",
    message: string,
  ) {
    super(message);
  }
}
