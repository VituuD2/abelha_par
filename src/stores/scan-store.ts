import { create } from "zustand";
import type { ScanOrder, ScannerState, ScanResult } from "@/types";
import { normalizeTrackingForScan, trackingCodesMatch } from "@/lib/tracking";

interface ScanStore {
  // Session data
  orders: ScanOrder[];
  state: ScannerState;
  currentResult: ScanResult | null;

  // Computed
  scannedCount: number;
  totalCount: number;
  progress: number;

  // Actions
  setOrders: (orders: ScanOrder[]) => void;
  processBarcode: (code: string) => ScanResult;
  acknowledgeError: () => void;
  acknowledgeSuccess: () => void;
  saveBatch: () => Promise<void>;
  reset: () => void;
}

export const useScanStore = create<ScanStore>((set, get) => ({
  orders: [],
  state: "idle",
  currentResult: null,
  scannedCount: 0,
  totalCount: 0,
  progress: 0,

  setOrders: (orders) =>
    set({
      orders,
      state: "scanning",
      scannedCount: 0,
      totalCount: orders.length,
      progress: 0,
      currentResult: null,
    }),

  processBarcode: (code: string) => {
    const { orders } = get();
    const normalizedCode = normalizeTrackingForScan(code);

    // Find order by tracking code
    const orderIndex = orders.findIndex(
      (o) =>
        o.status === "pending" &&
        trackingCodesMatch(o.trackingCode, normalizedCode)
    );

    if (orderIndex === -1) {
      // Check if it was already scanned
      const alreadyScanned = orders.find(
        (o) =>
          o.status === "checked" &&
          trackingCodesMatch(o.trackingCode, normalizedCode)
      );

      const result: ScanResult = {
        type: "error",
        message: alreadyScanned
          ? `Pedido já bipado: ${alreadyScanned.clientName} (${alreadyScanned.trackingCode})`
          : `Código não encontrado na lista: ${code.trim()}`,
        order: alreadyScanned || undefined,
      };

      set({ currentResult: result, state: "error" });
      return result;
    }

    // Mark order as checked
    const updatedOrders = [...orders];
    updatedOrders[orderIndex] = {
      ...updatedOrders[orderIndex],
      status: "checked",
      scannedAt: new Date().toISOString(),
    };

    const scannedCount = updatedOrders.filter(
      (o) => o.status === "checked"
    ).length;
    const isComplete = scannedCount === updatedOrders.length;

    const result: ScanResult = {
      type: "success",
      message: `✓ ${updatedOrders[orderIndex].clientName}`,
      order: updatedOrders[orderIndex],
    };

    set({
      orders: updatedOrders,
      currentResult: result,
      scannedCount,
      progress: (scannedCount / updatedOrders.length) * 100,
      state: isComplete ? "complete" : "success",
    });

    return result;
  },

  acknowledgeError: () => {
    set({ currentResult: null, state: "scanning" });
  },

  acknowledgeSuccess: () => {
    const { state } = get();
    if (state !== "complete") {
      set({ currentResult: null, state: "scanning" });
    }
  },

  saveBatch: async () => {
    // This will be called from the component with Supabase client
    // The store just manages state
  },

  reset: () =>
    set({
      orders: [],
      state: "idle",
      currentResult: null,
      scannedCount: 0,
      totalCount: 0,
      progress: 0,
    }),
}));
