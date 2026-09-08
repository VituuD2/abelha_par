"use client";

import { useEffect, useState } from "react";
import { startTrackingRefresh } from "@/lib/tracking-refresh";
import { useScanStore } from "@/stores/scan-store";

export function useTrackingRefresh() {
  const sessionVersion = useScanStore((state) => state.sessionVersion);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => startTrackingRefresh({
    getSession: useScanStore.getState,
    applyUpdates: (updates, version) => useScanStore.getState().updateTrackingCodes(updates, version),
    onError: setRefreshError,
  }), [sessionVersion]);

  return refreshError;
}
