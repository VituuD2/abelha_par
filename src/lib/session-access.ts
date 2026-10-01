export type SessionAccess = { userId: string; role: "admin" | "operator" };
export type SessionAccessSnapshot = { userId: string | null; role: SessionAccess["role"] | null; loading: boolean; error: string | null };

/** Bind UI privileges to the current identity, never to a cached layout or an older request. */
export function createSessionAccessMonitor(load: () => Promise<SessionAccess>, publish: (snapshot: SessionAccessSnapshot) => void) {
  let snapshot: SessionAccessSnapshot = { userId: null, role: null, loading: true, error: null };
  let generation = 0;
  let disposed = false;
  const emit = (next: SessionAccessSnapshot) => { snapshot = next; publish(next); };

  async function refresh() {
    const userId = snapshot.userId;
    if (disposed || !userId) return;
    const request = ++generation;
    try {
      const access = await load();
      if (disposed || request !== generation || snapshot.userId !== userId) return;
      if (access.userId !== userId || !["admin", "operator"].includes(access.role)) {
        throw new Error("A sessão mudou. Entre novamente para confirmar seu acesso.");
      }
      emit({ userId, role: access.role, loading: false, error: null });
    } catch (error) {
      if (disposed || request !== generation || snapshot.userId !== userId) return;
      emit({ userId, role: null, loading: false, error: error instanceof Error ? error.message : "Não foi possível verificar seu acesso." });
    }
  }

  function observeSession(userId: string | null) {
    if (disposed) return;
    if (userId !== snapshot.userId || snapshot.loading) {
      generation++;
      emit({ userId, role: null, loading: Boolean(userId), error: null });
    }
    if (!userId) { generation++; emit({ userId: null, role: null, loading: false, error: null }); return; }
    void refresh();
  }

  return { observeSession, refresh, dispose() { disposed = true; generation++; } };
}
