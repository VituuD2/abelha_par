import { hasTrackingCode } from "@/lib/tracking";

type IncomingOrder = { id?: unknown; yampiId?: unknown; trackingCode?: unknown; clientName?: unknown; dataCriacao?: unknown; scannedAt?: unknown; status?: unknown };

export function sanitizeOrders(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) return null;
  const orders = value as (IncomingOrder | null)[];
  if (orders.some((order) => !order || order.status !== "checked" || typeof order.id !== "number" || typeof order.yampiId !== "string" || typeof order.trackingCode !== "string" || order.trackingCode.length > 200 || !hasTrackingCode(order.trackingCode) || typeof order.clientName !== "string")) return null;
  return (orders as IncomingOrder[]).map((order) => ({
    id: order.id as number,
    yampiId: (order.yampiId as string).slice(0, 100),
    trackingCode: (order.trackingCode as string).trim(),
    clientName: (order.clientName as string).slice(0, 300),
    dataCriacao: typeof order.dataCriacao === "string" ? order.dataCriacao.slice(0, 64) : null,
    scannedAt: typeof order.scannedAt === "string" ? order.scannedAt : null,
  }));
}
