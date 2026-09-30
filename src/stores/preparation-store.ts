import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { NuvemshopOrder, OlistOrder, ReconciliationConfig } from "@/types";

interface PreparationStore {
  ownerId: string | null;
  nuvemshopOrders: NuvemshopOrder[];
  selectedIds: number[];
  confirmedIds: number[];
  confirmedAt: string | null;
  olistOrders: OlistOrder[];
  olistFetchedAt: string | null;
  mapping: ReconciliationConfig | null;
  bindOwner: (ownerId: string | null) => void;
  setNuvemshopOrders: (orders: NuvemshopOrder[]) => void;
  setSelectedIds: (ids: number[]) => void;
  invalidateSelection: () => void;
  confirmSelection: () => void;
  setOlistOrders: (orders: OlistOrder[]) => void;
  setMapping: (mapping: ReconciliationConfig | null) => void;
  reset: () => void;
}
const initial = { nuvemshopOrders: [], selectedIds: [], confirmedIds: [], confirmedAt: null, olistOrders: [], olistFetchedAt: null, mapping: null };
export const usePreparationStore = create<PreparationStore>()(persist((set, get) => ({
  ...initial, ownerId: null,
  bindOwner: ownerId => { if (get().ownerId !== ownerId) set({ ...initial, ownerId }); },
  setNuvemshopOrders: nuvemshopOrders => set(state => ({ nuvemshopOrders, selectedIds: state.selectedIds.filter(id => nuvemshopOrders.some(order => order.id === id && order.paymentStatus === "paid" && order.status !== "cancelled")), confirmedIds: [], confirmedAt: null })),
  setSelectedIds: selectedIds => set({ selectedIds, confirmedIds: [], confirmedAt: null }),
  invalidateSelection: () => set({ confirmedIds: [], confirmedAt: null }),
  confirmSelection: () => set(state => ({ confirmedIds: [...state.selectedIds], confirmedAt: new Date().toISOString() })),
  setOlistOrders: olistOrders => set({ olistOrders, olistFetchedAt: new Date().toISOString() }),
  setMapping: mapping => set({ mapping }),
  reset: () => set(initial),
}), { name: "abelha-preparation-v1", storage: createJSONStorage(() => sessionStorage), skipHydration: true }));
