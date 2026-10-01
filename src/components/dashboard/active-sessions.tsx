"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { useScanStore } from "@/stores/scan-store";

type SessionSummary = { id: string; responsible: string; checked: number; total: number; updatedAt: string };

export function ActiveSessions() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const response = await fetch("/api/scan-sessions", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Não foi possível verificar os lotes.");
    setSessions(data.sessions); setError(null);
  }, []);
  useEffect(() => { load().catch(reason => setError(reason.message)); }, [load]);
  async function resume(id: string) {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/scan-sessions/${id}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.session || data.session.status !== "active") throw new Error(data.error || "Este lote já foi encerrado. Atualize a lista.");
      useScanStore.getState().setSession(data.session); router.push("/scanner");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível abrir o lote."); }
    finally { setBusy(false); }
  }
  return <section className="card p-5 mb-6 space-y-4"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Lotes em andamento</h2><p className="text-sm text-[var(--color-text-secondary)]">Conferências compartilhadas com a equipe.</p></div><button className="btn-ghost" disabled={busy} onClick={() => load().catch(reason => setError(reason.message))}><RefreshCw className="w-4 h-4" /><span className="hidden sm:inline">Atualizar</span></button></div>
    {sessions.length ? <ul className="divide-y divide-[var(--color-border-light)]">{sessions.map(session => <li key={session.id} className="flex flex-wrap justify-between items-center gap-3 py-3"><div><p className="font-medium">{session.responsible}</p><p className="text-xs text-[var(--color-text-secondary)]">{session.checked} de {session.total} bipados · {new Date(session.updatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</p></div><button className="btn-ghost text-[var(--color-accent-blue)]" disabled={busy} onClick={() => resume(session.id)}>Retomar lote</button></li>)}</ul> : <p className="text-sm text-[var(--color-text-tertiary)]">Nenhum lote em andamento.</p>}
    {error && <p role="alert" className="text-sm text-[var(--color-accent-red)]">{error}</p>}
  </section>;
}
