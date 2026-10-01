"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Cloud, Loader2, RefreshCw } from "lucide-react";
import type { OlistOrder, ReconciliationConfig } from "@/types";
import { isValidDateRange, saoPauloDate } from "@/lib/dates";
import { useAppAccess } from "@/components/layout/app-shell";

interface ApiFetchCardProps {
  onFetch: (orders: OlistOrder[], dateMode: "created" | "updated", mapping: ReconciliationConfig | null) => void;
  onFetchStart: () => void;
  disabled?: boolean;
}

export function ApiFetchCard({ onFetch, onFetchStart, disabled }: ApiFetchCardProps) {
  const { isAdmin } = useAppAccess();
  const [dateFrom, setDateFrom] = useState(() => saoPauloDate());
  const [dateTo, setDateTo] = useState(() => saoPauloDate());
  const [dateMode, setDateMode] = useState<"created" | "updated">("updated");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const check = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível verificar a Olist.");
      setConnected(data.isConnected); setMessage(data.message || null);
    } catch (reason) { setConnected(false); setError(reason instanceof Error ? reason.message : "Falha ao verificar a conexão."); }
    finally { setChecking(false); }
  }, []);
  useEffect(() => {
    void check();
    const timer = setInterval(() => { void check(); }, 10 * 60_000);
    const onFocus = () => { void check(); };
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); controller.current?.abort(); };
  }, [check]);

  async function handleFetch() {
    if (disabled || loading) return;
    if (!isValidDateRange(dateFrom, dateTo)) { setError("Informe um período válido de até 31 dias."); return; }
    setLoading(true); setError(null); setCount(null); onFetchStart();
    const abort = new AbortController(); controller.current = abort;
    try {
      const collected = new Map<number, OlistOrder>();
      let cursor: { day: number; offset: number } | null = null;
      let mapping: ReconciliationConfig | null = null;
      let retries = 0;
      do {
        abort.signal.throwIfAborted();
        const response: Response = await fetch("/api/olist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dateFrom, dateTo, dateMode, cursor: cursor || undefined }), signal: abort.signal });
        const data = await response.json();
        if (response.status === 429 && retries++ < 5) {
          const seconds = Math.min(300, Math.max(1, Number(data.retryAfterSeconds) || 60));
          setError(`Limite de consultas. Retomando em ${seconds} segundos…`);
          await new Promise(resolve => setTimeout(resolve, seconds * 1000)); continue;
        }
        if (!response.ok) {
          if (data.needsReconnect) { setConnected(false); setMessage(data.error); }
          throw new Error(data.error || "Não foi possível buscar os pedidos.");
        }
        if (!Array.isArray(data.orders)) throw new Error("Resposta inválida da Olist.");
        retries = 0; setError(null);
        for (const order of data.orders as OlistOrder[]) collected.set(order.id, order);
        setCount(collected.size); mapping = data.mapping; cursor = data.nextCursor;
        if (cursor) await new Promise(resolve => setTimeout(resolve, 2100));
      } while (cursor || retries > 0);
      if (!abort.signal.aborted) onFetch([...collected.values()], dateMode, mapping);
    } catch (reason) { if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha ao buscar pedidos."); }
    finally { if (!abort.signal.aborted) setLoading(false); }
  }

  return <section className="card p-6 flex flex-col gap-4 h-full">
    <div className="flex items-center gap-3"><div className="p-3 rounded-xl bg-[var(--color-accent-blue)]/10"><Cloud className="w-6 h-6 text-[var(--color-accent-blue)]" /></div><div><h2 className="text-xl font-semibold">Pedidos Olist</h2><p className="text-sm text-[var(--color-text-secondary)]">Conexão compartilhada da colmeia</p></div><span className={`badge ml-auto ${connected ? "badge-checked" : "badge-pending"}`}>{checking ? "Verificando…" : connected ? "Conectada" : "Indisponível"}</span></div>
    {checking ? <Loader2 className="w-6 h-6 animate-spin mx-auto my-8" /> : connected ? <>
      <label className="text-sm">Critério de busca<select className="field mt-1" value={dateMode} onChange={event => setDateMode(event.target.value as "created" | "updated")} disabled={loading}><option value="updated">Data de atualização</option><option value="created">Data de criação</option></select></label>
      <div className="grid sm:grid-cols-2 gap-3"><label className="text-sm">De<input className="field mt-1" type="date" value={dateFrom} max={dateTo} disabled={loading} onChange={event => setDateFrom(event.target.value)} /></label><label className="text-sm">Até<input className="field mt-1" type="date" value={dateTo} min={dateFrom} disabled={loading} onChange={event => setDateTo(event.target.value)} /></label></div>
      <button className="btn-primary mt-auto" disabled={disabled || loading} onClick={handleFetch}>{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}{loading ? `${count || 0} pedidos carregados…` : "Buscar pedidos"}</button>
      {count !== null && !loading && !error && <p role="status" className="text-sm text-[var(--color-accent-green)]">{count} pedidos carregados.</p>}
    </> : <div className="space-y-3 py-5"><p>{message || "A conexão Olist precisa de atenção do administrador."}</p>{isAdmin ? <Link href="/ninho" className="btn-primary">Abrir Ninho</Link> : <p className="text-sm text-[var(--color-text-secondary)]">Peça a um administrador para revisar a conexão no Ninho.</p>}<button className="btn-ghost" onClick={check}>Verificar novamente</button></div>}
    {message && connected && <p className="text-sm text-[var(--color-accent-orange)]">{message}</p>}
    {error && <p role="alert" className="text-sm text-[var(--color-accent-red)]">{error}</p>}
  </section>;
}
