"use client";

import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { ApiFetchCard } from "@/components/dashboard/api-fetch-card";
import { usePreparationStore } from "@/stores/preparation-store";
import { useScanStore } from "@/stores/scan-store";
import { reconcileOrders } from "@/lib/reconciliation";
import { normalizeResponsible } from "@/lib/responsible";
import { orderReference } from "@/lib/order-reference";
import type { OlistOrder, ReconciliationConfig } from "@/types";

export default function DashboardPage() {
  const prep = usePreparationStore();
  const sessionId = useScanStore(state => state.sessionId);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [responsible, setResponsible] = useState("");
  const controller = useRef<AbortController | null>(null);
  const attempt = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const selected = useMemo(() => prep.nuvemshopOrders.filter(order => prep.confirmedIds.includes(order.id)), [prep.nuvemshopOrders, prep.confirmedIds]);
  const result = useMemo(() => prep.mapping && prep.confirmedAt && prep.olistFetchedAt
    ? reconcileOrders(selected, prep.olistOrders, prep.mapping) : null,
  [prep.mapping, prep.confirmedAt, prep.olistFetchedAt, selected, prep.olistOrders]);

  const onFetchStart = useCallback(() => {
    controller.current?.abort();
    usePreparationStore.setState({ olistOrders: [], olistFetchedAt: null });
    setError(null);
    setStatus("");
  }, []);

  const onFetch = useCallback(async (orders: OlistOrder[], _mode: "created" | "updated", mapping: ReconciliationConfig | null) => {
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(true);
    setError(null);
    usePreparationStore.getState().setMapping(mapping);
    try {
      const details: OlistOrder[] = [];
      let retries = 0;
      for (let start = 0; start < orders.length;) {
        abort.signal.throwIfAborted();
        setStatus(`Consultando detalhes na Olist: ${start} de ${orders.length}`);
        const response = await fetch("/api/olist/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orderIds: orders.slice(start, start + 5).map(order => order.id), forceRefresh: true }), signal: abort.signal });
        const data = await response.json();
        if (response.status === 429 && retries++ < 5) {
          const seconds = Math.min(300, Math.max(1, Number(data.retryAfterSeconds) || 60));
          setStatus(`A Olist limitou as consultas. Retomando em ${seconds} segundos…`);
          await new Promise(resolve => setTimeout(resolve, seconds * 1000));
          continue;
        }
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar os detalhes da Olist.");
        retries = 0;
        details.push(...data.orders);
        start += 5;
      }
      if (!abort.signal.aborted) usePreparationStore.getState().setOlistOrders(details);
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Falha ao carregar pedidos.");
    } finally { if (!abort.signal.aborted) { setBusy(false); setStatus(""); } }
  }, []);

  async function startScanning() {
    if (!result || result.issues.length || !result.orders.length || !normalizeResponsible(responsible) || starting) return;
    setStarting(true);
    setError(null);
    const key = JSON.stringify([prep.confirmedAt, prep.olistFetchedAt, responsible.trim()]);
    if (attempt.current?.key !== key) attempt.current = { key, id: crypto.randomUUID() };
    try {
      const response = await fetch("/api/scan-sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: attempt.current.id, responsible, nuvemshopIds: prep.confirmedIds, olistIds: result.orders.map(order => order.id) }), signal: AbortSignal.timeout(30_000) });
      const data = await response.json();
      if (!response.ok || !data.session) throw new Error(data.error || "Não foi possível iniciar a conferência.");
      useScanStore.getState().setSession(data.session);
      router.push("/scanner");
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao iniciar conferência."); }
    finally { setStarting(false); }
  }

  const ready = result && !result.issues.length && result.orders.length === selected.length && selected.length > 0;
  return <>
    <Header title="Preparar conferência" subtitle="Selecione os pedidos do dia na Nuvemshop e confira a correspondência na Olist." breadcrumbs={["Abelha Par", "Preparação"]} />
    {sessionId && <div className="card p-5 mb-6 flex flex-wrap items-center justify-between gap-3"><p>Existe uma conferência salva neste navegador.</p><Link href="/scanner" className="btn-primary">Retomar conferência</Link></div>}
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
      <section className="card p-6 flex flex-col gap-4">
        <h2 className="text-xl font-semibold">Pedidos do dia · Nuvemshop</h2>
        <p className="text-[var(--color-text-secondary)]">Marque os pedidos preparados pela equipe. A confirmação define exatamente quais pedidos entram neste lote.</p>
        <strong className="text-3xl">{prep.confirmedAt ? prep.confirmedIds.length : 0} <span className="text-base font-normal">pedidos confirmados</span></strong>
        <p className="text-sm">{prep.confirmedAt ? `Seleção confirmada em ${new Date(prep.confirmedAt).toLocaleString("pt-BR")}.` : "Aguardando seleção e confirmação na aba Pedidos do dia."}</p>
        <Link href="/orders" className="btn-primary self-start">{prep.confirmedAt ? "Revisar seleção" : "Selecionar pedidos"}</Link>
      </section>
      <ApiFetchCard onFetch={onFetch} onFetchStart={onFetchStart} disabled={busy || starting} />
    </div>
    {busy && <p role="status" className="card p-5 mb-5">{status}</p>}
    {error && <p role="alert" className="card p-5 mb-5 text-[var(--color-accent-red)]">{error}</p>}
    {!result && !busy && <p className="card p-6">{!prep.confirmedAt ? "Confirme a seleção dos pedidos na aba Pedidos do dia." : !prep.olistFetchedAt ? "Seleção confirmada. Busque os pedidos na Olist para liberar a bipagem." : "Configure o vínculo entre a Nuvemshop e a Olist no servidor para continuar."}</p>}
    {result && !busy && <section className="card p-6 space-y-5">
      <h2 className="text-xl font-semibold">Conferência entre plataformas</h2>
      <p>{result.orders.length} de {selected.length} pedidos encontrados · {result.ignored} pedidos da Olist fora da seleção</p>
      {result.issues.length > 0 && <div role="alert" className="rounded-lg p-4 bg-[var(--color-accent-red)]/10"><p className="font-semibold mb-2">Resolva as pendências para iniciar a bipagem:</p><ul className="list-disc pl-5 space-y-1">{result.issues.map((issue, i) => <li key={i}>Nuvemshop #{issue.orderNumber}: {issue.message}</li>)}</ul><p className="mt-3 text-sm">Aguarde a importação na Olist e busque novamente. Amplie o período para incluir pedidos criados em outros dias.</p></div>}
      {result.orders.some(order => !order.trackingCode.trim()) && <p className="text-[var(--color-accent-orange)]">Há pedidos sem rastreio. Eles entrarão na conferência e aguardarão o código da Olist para serem bipados.</p>}
      <div className="overflow-auto max-h-96"><table className="w-full text-sm text-left"><thead><tr><th className="p-3">Pedido</th><th className="p-3">Olist</th><th className="p-3">Cliente</th><th className="p-3">Rastreio</th></tr></thead><tbody>{result.orders.map(order => <tr key={order.id} className="border-t border-[var(--color-border-light)]"><td className="p-3">{orderReference(order)}</td><td className="p-3">#{order.numeroPedido}</td><td className="p-3">{order.clientName}</td><td className="p-3">{order.trackingCode || "Aguardando rastreio"}</td></tr>)}</tbody></table></div>
      <label className="block">Responsável pela conferência<input className="field mt-2 max-w-md block" maxLength={100} value={responsible} onChange={event => setResponsible(event.target.value)} placeholder="Nome do responsável" disabled={starting} /></label>
      <button className="btn-success" disabled={!ready || starting || !normalizeResponsible(responsible)} onClick={startScanning}>{starting ? "Validando e iniciando…" : "Iniciar bipagem"}</button>
    </section>}
  </>;
}
