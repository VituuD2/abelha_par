import { requestErrorMessage } from "./request-timeouts";

export type SessionAccess = { userId: string; role: "admin" | "operator" };
export type SessionAccessSnapshot = { userId: string | null; role: SessionAccess["role"] | null; loading: boolean; error: string | null; verifiedFor: string | null };

export const ACCESS_FRESHNESS_MS = 60_000;
export const PROTECTED_ACCESS_FRESHNESS_MS = 15_000;

/** In-memory UI snapshot only. Server operations always check membership again. */
export function createSessionAccessMonitor(
  load: (signal: AbortSignal) => Promise<SessionAccess>,
  publish: (snapshot: SessionAccessSnapshot) => void,
  { initialAccess = null, initialScope = null, now = Date.now }: {
    initialAccess?: SessionAccess | null;
    initialScope?: string | null;
    now?: () => number;
  } = {},
) {
  let snapshot: SessionAccessSnapshot = {
    userId: initialAccess?.userId || null, role: initialAccess?.role || null,
    loading: !initialAccess, error: null, verifiedFor: initialAccess ? initialScope : null,
  };
  let checkedAt = initialAccess ? now() : -Infinity;
  let generation = 0;
  let disposed = false;
  let inFlight: { scope: string | null; invalidate: boolean; controller: AbortController; promise: Promise<void> } | null = null;
  const emit = (next: SessionAccessSnapshot) => {
    if (snapshot.userId === next.userId && snapshot.role === next.role && snapshot.loading === next.loading &&
      snapshot.error === next.error && snapshot.verifiedFor === next.verifiedFor) return;
    snapshot = next;
    publish(next);
  };

  function refresh(scope: string | null = null, {
    invalidate = false, force = false, maxAgeMs = ACCESS_FRESHNESS_MS,
  }: { invalidate?: boolean; force?: boolean; maxAgeMs?: number } = {}): Promise<void> {
    const userId = snapshot.userId;
    if (disposed || !userId) return Promise.resolve();
    // Focus, visibility and auth notifications often arrive together.
    if (inFlight && inFlight.scope === scope && (!invalidate || inFlight.invalidate)) return inFlight.promise;
    if (!invalidate && !force && !snapshot.error && snapshot.role && now() - checkedAt < maxAgeMs) return Promise.resolve();
    inFlight?.controller.abort();
    const request = ++generation;
    const controller = new AbortController();
    // A protected route must wait for a fresh check, without erasing the menu.
    if (invalidate) emit({ ...snapshot, verifiedFor: null });
    if (snapshot.error) emit({ ...snapshot, loading: true });
    const promise = Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      try {
        const access = await load(controller.signal);
        if (disposed || request !== generation || snapshot.userId !== userId) return;
        if (access.userId !== userId || !["admin", "operator"].includes(access.role)) {
          throw new Error("A sessão mudou. Entre novamente para confirmar seu acesso.");
        }
        checkedAt = now();
        emit({ userId, role: access.role, loading: false, error: null, verifiedFor: scope });
      } catch (error) {
        if (disposed || request !== generation || snapshot.userId !== userId) return;
        checkedAt = -Infinity;
        emit({ userId, role: null, loading: false, error: requestErrorMessage(error, "Não foi possível verificar seu acesso."), verifiedFor: null });
      } finally {
        if (request === generation) inFlight = null;
      }
    });
    inFlight = { scope, invalidate, controller, promise };
    return promise;
  }

  function observeSession(userId: string | null, scope: string | null = null) {
    if (disposed) return;
    if (userId !== snapshot.userId) {
      inFlight?.controller.abort();
      inFlight = null;
      generation++;
      checkedAt = -Infinity;
      emit({ userId, role: null, loading: Boolean(userId), error: null, verifiedFor: null });
    }
    if (!userId) { emit({ userId: null, role: null, loading: false, error: null, verifiedFor: null }); return; }
    // SIGNED_IN may be emitted again on Alt+Tab for the same identity.
    void refresh(scope);
  }

  return { observeSession, refresh, dispose() { disposed = true; generation++; inFlight?.controller.abort(); inFlight = null; } };
}
