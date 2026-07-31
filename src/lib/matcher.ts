import type { OlistOrder, ScanOrder } from "@/types";

/**
 * Cross-references Olist orders against Yampi spreadsheet IDs.
 * Returns only orders whose yampiId exists in the spreadsheet.
 * Each matched order becomes a ScanOrder with 'pending' status.
 */
export function matchOrders(
  olistOrders: OlistOrder[],
  yampiIds: Set<string>
): ScanOrder[] {
  return olistOrders
    .filter((order) => order.yampiId !== null && yampiIds.has(order.yampiId))
    .map((order) => ({
      ...order,
      yampiId: order.yampiId as string,
      status: "pending" as const,
    }));
}

/**
 * Returns orders from Olist that have NO matching Yampi ID in the spreadsheet.
 * Useful for showing unmatched/orphan orders.
 */
export function getUnmatchedOrders(
  olistOrders: OlistOrder[],
  yampiIds: Set<string>
): OlistOrder[] {
  return olistOrders.filter(
    (order) => order.yampiId === null || !yampiIds.has(order.yampiId)
  );
}

/**
 * Returns Yampi IDs from the spreadsheet that have no corresponding Olist order.
 */
export function getMissingFromOlist(
  olistOrders: OlistOrder[],
  yampiIds: Set<string>
): string[] {
  const olistYampiIds = new Set(
    olistOrders.map((o) => o.yampiId).filter(Boolean) as string[]
  );
  return Array.from(yampiIds).filter((id) => !olistYampiIds.has(id));
}
