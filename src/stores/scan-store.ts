import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ScanOrder, ScannerState, ScanResult, StoredScanSession } from "@/types";
import { hasTrackingCode } from "@/lib/tracking";
import { applyScan } from "@/lib/scan-session";

interface ScanStore {
  ownerId: string | null;
  sessionId: string | null;
  revision: number;
  busy: boolean;
  restoreError: string | null;
  orders: ScanOrder[];
  responsible: string;
  sessionVersion: number;
  state: ScannerState;
  currentResult: ScanResult | null;
  scannedCount: number;
  totalCount: number;
  progress: number;
  bindOwner: (ownerId: string | null) => void;
  setOrders: (orders: ScanOrder[], responsible: string) => void;
  setSession: (session: StoredScanSession) => void;
  restoreSession: () => Promise<void>;
  submitBarcode: (code: string) => Promise<void>;
  updateTrackingCodes: (updates: { id: number; trackingCode: string }[], sessionVersion: number) => void;
  processBarcode: (code: string) => ScanResult;
  acknowledgeError: () => void;
  acknowledgeSuccess: () => void;
  reset: () => void;
}

function counts(orders: ScanOrder[]) {
  const scannedCount = orders.filter(order => order.status === "checked").length;
  return { orders, scannedCount, totalCount: orders.length, progress: orders.length ? scannedCount / orders.length * 100 : 0 };
}
const initial = { sessionId: null, revision: -1, busy: false, restoreError: null, orders: [], responsible: "", state: "idle" as ScannerState, currentResult: null, scannedCount: 0, totalCount: 0, progress: 0 };

export const useScanStore = create<ScanStore>()(persist((set, get) => ({
  ...initial, ownerId: null, sessionVersion: 0,
  bindOwner: ownerId => { if (get().ownerId !== ownerId) set(current => ({ ...initial, ownerId, sessionVersion: current.sessionVersion + 1 })); },
  setOrders: (orders, responsible) => set(current => ({ ...initial, ...counts(orders), responsible, state: "scanning", sessionVersion: current.sessionVersion + 1 })),
  setSession: session => set(current => ({
    ...counts(session.orders), sessionId: session.id, responsible: session.responsible, revision: session.revision,
    state: session.orders.every(order => order.status === "checked") ? "complete" : "scanning",
    currentResult: null, restoreError: null, sessionVersion: current.sessionVersion + 1,
  })),
  restoreSession: async () => {
    const { sessionId, sessionVersion, busy } = get();
    if (!sessionId || busy) return;
    set({ busy: true, restoreError: null });
    try {
      const response = await fetch(`/api/scan-sessions/${sessionId}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
      const payload = await response.json();
      if (get().sessionVersion !== sessionVersion) return;
      if (!response.ok || !payload.session) throw new Error(payload.error || "Não foi possível recuperar o lote.");
      get().setSession(payload.session);
    } catch (error) {
      if (get().sessionVersion === sessionVersion) set({ restoreError: error instanceof Error ? error.message : "Falha ao recuperar lote." });
    } finally { if (get().sessionId === sessionId) set({ busy: false }); }
  },
  submitBarcode: async code => {
    const { sessionId, sessionVersion, busy } = get();
    if (!sessionId || busy) return;
    set({ busy: true });
    try {
      const response = await fetch(`/api/scan-sessions/${sessionId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(30_000) });
      const payload = await response.json();
      if (get().sessionVersion !== sessionVersion) return;
      if (!response.ok || !payload.session || !payload.result) throw new Error(payload.error || "Não foi possível registrar a bipagem. Tente novamente.");
      const session = payload.session as StoredScanSession;
      const complete = session.orders.every(order => order.status === "checked");
      set({ ...counts(session.orders), revision: session.revision, currentResult: payload.result, state: complete ? "complete" : payload.result.type });
    } catch (error) {
      if (get().sessionVersion === sessionVersion) set({ state: "error", currentResult: { type: "error", message: error instanceof Error ? error.message : "Falha ao registrar bipagem." } });
    } finally { if (get().sessionVersion === sessionVersion) set({ busy: false }); }
  },
  updateTrackingCodes: (updates, sessionVersion) => set(current => {
    if (current.sessionVersion !== sessionVersion) return current;
    const byId = new Map(updates.map(order => [order.id, order.trackingCode]));
    return { orders: current.orders.map(order => {
      const trackingCode = byId.get(order.id);
      if (order.status !== "pending" || hasTrackingCode(order.trackingCode) || !hasTrackingCode(trackingCode)) return order;
      return { ...order, trackingCode: trackingCode!.trim() };
    }) };
  }),
  // Pure local transition retained for tests; the UI submits to the server.
  processBarcode: code => {
    const { orders, result } = applyScan(get().orders, code);
    set({ ...counts(orders), currentResult: result, state: result.type === "error" ? "error" : orders.every(order => order.status === "checked") ? "complete" : "success" });
    return result;
  },
  acknowledgeError: () => set({ currentResult: null, state: "scanning" }),
  acknowledgeSuccess: () => { if (get().state !== "complete") set({ currentResult: null, state: "scanning" }); },
  reset: () => set(current => ({ ...initial, sessionVersion: current.sessionVersion + 1 })),
}), {
  name: "abelha-scan-session-v1", storage: createJSONStorage(() => localStorage), skipHydration: true,
  partialize: state => ({ ownerId: state.ownerId, sessionId: state.sessionId }),
}));
