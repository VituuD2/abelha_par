"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { summarizeApiUsage, type ApiUsage } from "@/lib/olist-api-types";
import { ACCESS_REQUEST_TIMEOUT_MS, requestErrorMessage } from "@/lib/request-timeouts";
import { LoadingRegion, RowsSkeleton } from "@/components/ui/loading-region";

const time = (value: string | number) => new Date(value).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

/** One read and one poll for all cards. Reads stored counters only. */
export function useOlistApiUsage() {
  const [data, setData] = useState<ApiUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [foregroundLoading, setForegroundLoading] = useState(false);
  const pending = useRef(false), controller = useRef<AbortController | null>(null);
  const load = useCallback(async (foreground = false) => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setForegroundLoading(foreground);
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch("/api/analytics/api-usage", { cache: "no-store", signal: AbortSignal.any([request.signal, AbortSignal.timeout(ACCESS_REQUEST_TIMEOUT_MS)]) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Consumo indisponível.");
      if (!request.signal.aborted) { setData(value); setError(null); }
    } catch (reason) {
      if (!request.signal.aborted) setError(requestErrorMessage(reason, "Consumo indisponível."));
    } finally {
      pending.current = false;
      if (!request.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 15000);
    return () => { clearInterval(timer); controller.current?.abort(); pending.current = false; };
  }, [load]);
  return { data, error, loading, foregroundLoading, refresh: () => load(true) };
}

export function OlistApiMonitor({ connectionId, usage }: { connectionId: string; usage: ReturnType<typeof useOlistApiUsage> }) {
  const { data, error, loading, foregroundLoading, refresh } = usage;
  const account = data?.accounts?.find(a => a.connection_id === connectionId);
  const summary = account && data?.generated_at ? summarizeApiUsage(account, data.generated_at) : null;
  const now = Math.max(Date.now(), Date.parse(data?.generated_at || "") || 0);
  const fresh = !!account?.observed_at && !!account.provider_reset_at && Date.parse(account.provider_reset_at) > now && now - Date.parse(account.observed_at) < 120000;
  const hasSample = account?.provider_limit != null && account.provider_remaining != null && !!account.observed_at;
  return <section className="space-y-3 border-t border-[var(--color-border-light)] pt-4" aria-label="Consumo da API Olist">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold">Consumo da API</h4>
      <button type="button" disabled={loading} aria-label="Atualizar consumo" className="btn-ghost !p-2" onClick={() => void refresh()}><RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /></button>
    </div>
    {error && <p className="text-xs text-amber-900" role="status">{error} Dados desatualizados.</p>}
    <LoadingRegion label="Dados de consumo da API" loading={loading && (!data || foregroundLoading)} className="min-h-60" skeleton={<RowsSkeleton rows={3} />}>
    {!data ? <p className="text-xs text-[var(--color-text-secondary)]">Consultando consumo…</p>
      : !data.available ? <p className="text-xs" role="status">{data.error || "Monitor indisponível."}</p>
      : !account || !summary ? <p className="text-xs text-[var(--color-text-secondary)]">Sem medição desta conexão.</p> : <>
        <dl className="grid grid-cols-2 gap-3 rounded-xl bg-[var(--color-bg-secondary)] p-3">
          <div><dt className="text-xs text-[var(--color-text-secondary)]">App · último minuto</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{summary.lastMinuteMeasured ? summary.lastMinute : "—"}<span className="ml-1 text-xs font-normal text-[var(--color-text-secondary)]">/ {account.effective_limit} chamadas</span></dd></div>
          <div><dt className="text-xs text-[var(--color-text-secondary)]">Conta · amostra Olist{!fresh && hasSample ? " antiga" : ""}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{hasSample ? `${account.provider_limit! - account.provider_remaining!}/${account.provider_limit}` : "Sem amostra"}</dd></div>
        </dl>
        {account.cooldown_until && Date.parse(account.cooldown_until) > now && <p className="text-xs text-amber-900">Retomada a partir de {time(account.cooldown_until)}</p>}
        <div className="flex h-10 items-end gap-1" role="img" aria-label={`Chamadas do app por minuto nos últimos 15 minutos de ${account.name}`}>
          {summary.bars.map(bar => <div key={bar.time} title={`${time(bar.time)}: ${bar.covered ? `${bar.requests} chamadas` : "sem medição"}`} className={`flex-1 rounded-t ${bar.covered ? "bg-amber-500" : "bg-stone-300"}`} style={{ height: `${Math.max(3, Math.min(100, bar.requests / Math.max(1, account.app_limit) * 100))}%` }} />)}
        </div>
        <div className="flex justify-between gap-2 text-xs text-[var(--color-text-secondary)]"><span>Últimos 15 min · app</span><span>{error ? "Desatualizado" : `Atualizado ${time(data.generated_at!)}`} · Brasília</span></div>
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">Detalhes de consumo</summary>
          <div className="mt-3 space-y-2 text-[var(--color-text-secondary)]">
            <p>{account.plan} · plano {account.plan_limit}/min · app {account.app_limit}/min · permitido {account.effective_limit}/min</p>
            <p>60 min: {summary.sources.orders} vendas · {summary.sources.costs} CMV · {summary.sources.operational} conferência · {summary.sources.identity} validação</p>
            <p>{summary.throttled} respostas 429 · {summary.failures} falhas · {summary.retries} novas tentativas · média {summary.averageMs === null ? "sem amostra" : `${summary.averageMs} ms`}</p>
            {!!summary.pendingResults && <p>{summary.pendingResults} tentativas sem resultado confirmado</p>}
            <p>{hasSample ? `Amostra da conta às ${time(account.observed_at!)} · saldo ${account.provider_remaining}` : "Saldo da conta não determinado."} · Cota compartilhada entre aplicativos.</p>
            <div className="overflow-x-auto"><table className="w-full text-left tabular-nums">
              <caption className="sr-only">Histórico de chamadas do app por minuto</caption>
              <thead><tr><th scope="col" className="py-1">Horário</th><th scope="col">Chamadas do app</th></tr></thead>
              <tbody>{[...summary.bars].reverse().map(bar => <tr key={bar.time}><td className="py-1">{time(bar.time)}</td><td>{bar.covered ? bar.requests : "Sem medição"}</td></tr>)}</tbody>
            </table></div>
          </div>
        </details>
      </>}
    </LoadingRegion>
  </section>;
}
