"use client";

import { useCallback, useEffect } from "react";
import { useScanStore } from "@/stores/scan-store";
import type { ScanOrder } from "@/types";

export function useScanner() {
  const state = useScanStore((state) => state.state);
  const orders = useScanStore((state) => state.orders);
  const scannedCount = useScanStore((state) => state.scannedCount);
  const totalCount = useScanStore((state) => state.totalCount);
  const progress = useScanStore((state) => state.progress);
  const currentResult = useScanStore((state) => state.currentResult);
  const processBarcode = useScanStore((state) => state.processBarcode);
  const acknowledgeError = useScanStore((state) => state.acknowledgeError);
  const acknowledgeSuccess = useScanStore((state) => state.acknowledgeSuccess);
  const setOrders = useScanStore((state) => state.setOrders);
  const reset = useScanStore((state) => state.reset);

  return {
    state,
    orders,
    scannedCount,
    totalCount,
    progress,
    currentResult,
    processBarcode,
    acknowledgeError,
    acknowledgeSuccess,
    setOrders,
    reset,
  };
}
