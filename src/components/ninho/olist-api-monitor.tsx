"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { summarizeApiUsage, type ApiUsage } from "@/lib/olist-api-types";

const time = (value: string | number) => new Date(value).toLocaleTimeString("pt-BR", {timeZone: "America/Sao_Paulo", hour:"2-digit", minute:"2-digit", second:"2-digit"});
export function OlistApiMonitor() {
  const [data, setData] = useState<ApiUsage | null>(null), [error,setError] = useState<string | null>(null);
  const pending = useRef(false), controller = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const request = new AbortController(); controller.current = request;
    try {
      const response = await fetch("/api/analytics/api-usage", {cache:"no-store", signal:AbortSignal.any([request.signal,AbortSignal.timeout(10000)])});
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "Não foi possível atualizar o consumo.");
      if (!request.signal.aborted) { setData(value); setError(null); }
    } catch (reason) {
      if (!request.signal.aborted) setError(reason instanceof Error ? reason.message : "Monitor indisponível.");
    } finally { pending.current = false; }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") void load(); }, 15000);
    return () => { clearInterval(timer); controller.current?.abort(); };
  }, [load]);
  return <section className="rounded-xl border border-[var(--color-border-light)] p-4 space-y-3" aria-label="Consumo da API Olist">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">Consumo da API Olist</h3>
      <button type="button" className="btn-ghost" onClick={() => void load()}>Atualizar consumo</button>
    </div>
    <p className="text-xs text-[var(--color-text-secondary)]">Chamadas de leitura do nosso app incluem vendas, CMV, conferência e novas tentativas. O saldo informado pela Olist considera os aplicativos que compartilham a cota da conta; não identifica o consumo de cada marketplace.</p>
    {error && <p className="text-xs text-red-800" role="status">{error} Os valores anteriores podem estar desatualizados.</p>}
    {!data ? <p className="text-xs">Consultando consumo…</p> : !data.available ? <p className="text-xs" role="status">{data.error || "Monitor aguardando ativação."}</p> : <>
      <p className="text-xs text-[var(--color-text-secondary)]">Atualizado às {time(data.generated_at!)} · janela de 60 minutos · horários de São Paulo. Minutos monitorados sem chamadas aparecem como zero; barras cinza indicam ausência de medição.</p>
      {data.accounts?.map(account => {
        const summary = summarizeApiUsage(account, data.generated_at!);
        const fresh = !!account.observed_at && !!account.provider_reset_at && Date.parse(account.provider_reset_at) > Date.parse(data.generated_at!)
          && Date.parse(data.generated_at!) - Date.parse(account.observed_at) < 120000;
        return <div key={account.connection_id} className="rounded-lg bg-[var(--color-bg-secondary)] p-3 space-y-2">
          <h4 className="text-sm font-semibold">{account.name} · {account.plan}</h4>
          <p className="text-xs">Cota do plano: {account.plan_limit}/min · teto do app: {account.app_limit}/min · ritmo atual permitido: {account.effective_limit}/min{account.slow_until ? " · reduzido após limitação" : ""}{account.cooldown_until ? ` · aguardando até ${time(account.cooldown_until)}` : ""}</p>
          <p className="text-xs">{account.monitoring_since ? `Medição desta conta desde ${new Date(account.monitoring_since).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"})}.` : "Aguardando a primeira chamada monitorada."}</p>
          <div className="grid gap-2 text-xs sm:grid-cols-4">
            <p>Último minuto encerrado: <strong>{summary.lastMinuteMeasured ? summary.lastMinute : "Sem medição"}</strong></p>
            <p>Pico por minuto: <strong>{summary.peak}</strong></p>
            <p>Respostas 429: <strong>{summary.throttled}</strong></p>
            <p>Tempo médio: <strong>{summary.averageMs === null ? "Sem amostra" : `${summary.averageMs} ms`}</strong></p>
          </div>
          <p className="text-xs">Na janela: vendas {summary.sources.orders} · CMV {summary.sources.costs} · conferência {summary.sources.operational} · validação {summary.sources.identity} · novas tentativas {summary.retries} · falhas 5xx/rede/timeout {summary.failures}.</p>
          <p className="text-xs">{account.provider_limit !== null && account.provider_remaining !== null && account.observed_at
            ? `Consumo total observado na conta: ${account.provider_limit-account.provider_remaining}/${account.provider_limit}, com ${account.provider_remaining} chamadas restantes na amostra das ${time(account.observed_at)}${fresh ? "." : " (amostra antiga)."}${account.provider_reset_at ? ` Renovação da janela indicada para ${time(account.provider_reset_at)}.` : ""}`
            : "Consumo total da conta: sem amostra dos cabeçalhos da Olist. Consumo das outras integrações não determinado."}</p>
          <div className="flex h-12 items-end gap-1" role="img" aria-label={`Chamadas do app por minuto nos últimos 15 minutos de ${account.name}`}>
            {summary.bars.map(bar => <div key={bar.time} title={`${time(bar.time)}: ${bar.covered ? `${bar.requests} chamadas` : "sem medição"}`} className={`flex-1 rounded-t ${bar.covered ? "bg-amber-500" : "bg-gray-300"}`} style={{height:`${Math.max(3,Math.min(100,bar.requests/account.app_limit*100))}%`}} />)}
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer font-medium">Histórico por minuto</summary>
            <div className="overflow-x-auto mt-2"><table className="w-full text-left">
              <thead><tr><th className="p-1">Minuto</th><th className="p-1">Nosso app</th><th className="p-1">Consumo total observado</th><th className="p-1">Saldo na amostra</th></tr></thead>
              <tbody>{[...summary.bars].reverse().map(bar => {
                const sample = account.samples?.find(s => Date.parse(s.minute)===bar.time);
                return <tr key={bar.time}><td className="p-1">{time(bar.time)}</td><td className="p-1">{bar.covered ? bar.requests : "Sem medição"}</td>
                  <td className="p-1">{sample ? `${sample.provider_limit-sample.provider_remaining}/${sample.provider_limit} às ${time(sample.observed_at)}` : "Sem amostra"}</td>
                  <td className="p-1">{sample ? sample.provider_remaining : "—"}</td></tr>;
              })}</tbody>
            </table></div>
            <p className="mt-1">Cada linha guarda a amostra com maior consumo da conta observada naquele minuto, não o total final garantido da janela da Olist. Atualizar este monitor consulta apenas nosso banco.</p>
          </details>
          {!!summary.pendingResults && <p className="text-xs">{summary.pendingResults} tentativas com resultado ainda não confirmado. Os contadores incluem reservas feitas imediatamente antes da chamada; encerramentos inesperados podem deixá-las sem resposta registrada.</p>}
        </div>;
      })}
      <p className="text-xs text-[var(--color-text-secondary)]">O total da conta é uma amostra da janela de limite da Olist, que pode não coincidir com nossos minutos do relógio. Chamadas de outros aplicativos não são separadas por integração. Os tetos configurados não são aumentados automaticamente.</p>
    </>}
  </section>;
}
