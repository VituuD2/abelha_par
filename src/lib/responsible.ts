export function normalizeResponsible(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const responsible = value.trim().replace(/\s+/g, " ");
  if (responsible.length < 3 || responsible.length > 100) return null;
  return /^[\p{L}][\p{L}\p{M}' -]*$/u.test(responsible) ? responsible : null;
}
