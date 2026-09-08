import { hasTrackingCode } from "@/lib/tracking";
import type { ScanOrder } from "@/types";

type TrackingUpdate = { id: number; trackingCode: string };
type Session = { orders: ScanOrder[]; sessionVersion: number };

/** One sequential queue: five orders per request, with no overlapping requests. */
export function startTrackingRefresh({ getSession, applyUpdates, onError, fetcher = fetch }: {
  getSession: () => Session;
  applyUpdates: (updates: TrackingUpdate[], sessionVersion: number) => void;
  onError: (message: string | null) => void;
  fetcher?: typeof fetch;
}) {
  const version = getSession().sessionVersion;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  let queue: number[] = [];

  async function refresh() {
    const session = getSession();
    if (controller.signal.aborted || session.sessionVersion !== version) return;
    const missingIds = new Set(session.orders
      .filter((order) => order.status === "pending" && !hasTrackingCode(order.trackingCode))
      .map((order) => order.id));
    if (missingIds.size === 0) {
      onError(null);
      return;
    }
    queue = queue.filter((id) => missingIds.has(id));
    if (queue.length === 0) queue = [...missingIds];
    const orderIds = queue.splice(0, 5);
    let delay = queue.length > 0 ? 5_000 : 30_000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort();
    controller.signal.addEventListener("abort", abortRequest, { once: true });
    try {
      timeout = setTimeout(abortRequest, 45_000);
      const response = await fetcher("/api/olist/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
        signal: requestController.signal,
      });
      const payload = await response.json();
      if (controller.signal.aborted || getSession().sessionVersion !== version) return;
      if (response.status === 429) {
        const retry = Number(payload.retryAfterSeconds || response.headers.get("Retry-After"));
        delay = Math.max(60_000, Number.isFinite(retry) ? retry * 1000 : 60_000);
        throw new Error("A Olist limitou as consultas. A atualização será retomada automaticamente.");
      }
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar os rastreios.");
      if (!Array.isArray(payload.orders)) throw new Error("A Olist retornou uma resposta inválida.");
      const updates = payload.orders.filter((order: TrackingUpdate | null) =>
        order && orderIds.includes(order.id) && typeof order.trackingCode === "string"
      );
      applyUpdates(updates, version);
      onError(null);
    } catch (error) {
      if (controller.signal.aborted || getSession().sessionVersion !== version) return;
      delay = Math.max(delay, 30_000);
      onError(error instanceof Error && error.name !== "AbortError"
        ? `${error.message} Você pode continuar bipando os pedidos com rastreio.`
        : "A consulta demorou ou a conexão falhou. Tentaremos novamente automaticamente; continue bipando os pedidos com rastreio.");
    } finally {
      clearTimeout(timeout);
      controller.signal.removeEventListener("abort", abortRequest);
      if (!controller.signal.aborted && getSession().sessionVersion === version) {
        timer = setTimeout(() => { void refresh(); }, delay);
      }
    }
  }

  void refresh();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
