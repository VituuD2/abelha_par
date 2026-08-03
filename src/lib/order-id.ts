/** Normalizes IDs copied from spreadsheets and ERP text before comparison. */
export function normalizeOrderId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\s+/g, "")
    .replace(/\.0+$/, "");
  return normalized || null;
}
