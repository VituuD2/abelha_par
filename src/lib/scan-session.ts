import type { ScanOrder, ScanResult } from "@/types";
import { trackingCodesMatch } from "@/lib/tracking";

export function applyScan(orders: ScanOrder[], code: string, scannedAt = new Date().toISOString()): { orders: ScanOrder[]; result: ScanResult } {
  const matches = orders.filter(order => trackingCodesMatch(order.trackingCode, code));
  if (matches.length > 1) return { orders, result: { type: "error", message: "Este rastreio pertence a mais de um pedido. Revise o lote antes de continuar." } };
  const match = matches[0];
  if (!match) return { orders, result: { type: "error", message: `Código não encontrado na lista: ${code.trim()}` } };
  if (match.status === "checked") return { orders, result: { type: "error", message: `Pedido já bipado: ${match.clientName} (${match.trackingCode})`, order: match } };
  const checked: ScanOrder = { ...match, status: "checked", scannedAt };
  return { orders: orders.map(order => order.id === match.id ? checked : order), result: { type: "success", message: `✓ ${match.clientName}`, order: checked } };
}
