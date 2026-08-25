const CORREIOS_TRACKING_CODE = /^[A-Z]{2}\d{9}[A-Z]{2}$/;

/**
 * Keeps Correios identifiers intact and derives the eight-digit tracking
 * identifier printed at the end of a 20-character Loggi label.
 */
export function normalizeTrackingForScan(value: string) {
  const compact = value.trim().toUpperCase().replace(/\s+/g, "");
  if (CORREIOS_TRACKING_CODE.test(compact)) return compact;

  if (compact.length === 20) {
    const loggiTrackingCode = compact.slice(-8);
    if (/^[A-Z0-9]{8}$/.test(loggiTrackingCode)) return loggiTrackingCode;
  }

  return compact;
}

export function trackingCodesMatch(expected: string, scanned: string) {
  const normalizedExpected = normalizeTrackingForScan(expected);
  const normalizedScanned = normalizeTrackingForScan(scanned);
  return Boolean(normalizedExpected && normalizedScanned && normalizedExpected === normalizedScanned);
}

export function hasTrackingCode(value: string | null | undefined) {
  return typeof value === "string" && Boolean(normalizeTrackingForScan(value));
}
