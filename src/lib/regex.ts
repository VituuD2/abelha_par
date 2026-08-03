/**
 * Extracts the Yampi ID from the Olist order's observacoes/observacao_interna field.
 * Looks for patterns like "ID Yampi: 168722674" or "Yampi: 168722674" or "#168722674"
 */
export function extractYampiId(text: string): string | null {
  if (!text) return null;

  // Try "ID Yampi: 123456" pattern first
  const yampiMatch = text.match(/ID\s*Yampi\s*[:#-]?\s*(\d{6,})/i);
  if (yampiMatch) return yampiMatch[1];

  // Try "Yampi: 123456" pattern
  const yampiShort = text.match(/Yampi\s*[:#-]\s*(\d{6,})/i);
  if (yampiShort) return yampiShort[1];

  // Try "#123456" standalone number pattern (less specific, use as fallback)
  const hashMatch = text.match(/#(\d{6,})/);
  if (hashMatch) return hashMatch[1];

  return null;
}
