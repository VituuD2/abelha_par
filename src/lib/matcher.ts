import type { OlistOrder, ScanOrder } from "@/types";
import { normalizeOrderId } from "@/lib/order-id";

function normalizedIdSet(ids: Set<string>) {
  return new Set(Array.from(ids, normalizeOrderId).filter((id): id is string => id !== null));
}

/**
 * Cross-references Olist orders against Yampi spreadsheet IDs.
 * Returns only orders whose yampiId exists in the spreadsheet.
 * Each matched order becomes a ScanOrder with 'pending' status.
 */
export function matchOrders(
  olistOrders: OlistOrder[],
  yampiIds: Set<string>
): ScanOrder[] {
  const ids = normalizedIdSet(yampiIds);
  return olistOrders
    .filter((order) => {
      const id = normalizeOrderId(order.yampiId);
      return id !== null && ids.has(id);
    })
    .map((order) => ({
      ...order,
      yampiId: normalizeOrderId(order.yampiId) as string,
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
  const ids = normalizedIdSet(yampiIds);
  return olistOrders.filter(
    (order) => {
      const id = normalizeOrderId(order.yampiId);
      return id === null || !ids.has(id);
    }
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
    olistOrders.map((o) => normalizeOrderId(o.yampiId)).filter((id): id is string => id !== null)
  );
  return Array.from(yampiIds).filter((id) => {
    const normalized = normalizeOrderId(id);
    return normalized === null || !olistYampiIds.has(normalized);
  });
}
