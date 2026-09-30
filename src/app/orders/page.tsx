"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { NuvemshopConnection } from "@/components/dashboard/nuvemshop-connection";
import { usePreparationStore } from "@/stores/preparation-store";
import { saoPauloDate, isValidDateRange } from "@/lib/dates";
import { searchText, toggleOrderSelection } from "@/lib/order-selection";
import type { NuvemshopOrder } from "@/types";
import { Check, Search, ArrowRight, RefreshCw } from "lucide-react";

const paymentLabels: Record<string, string> = { paid: "Pago", pending: "Pendente", authorized: "Autorizado", refunded: "Estornado", partially_refunded: "Estorno parcial", partially_paid: "Pagamento parcial", voided: "Anulado", abandoned: "Abandonado" };
const shippingLabels: Record<string, string> = { unpacked: "Não embalado", unshipped: "Não enviado", unfulfilled: "Não enviado", shipped: "Enviado", fulfilled: "Enviado", delivered: "Entregue", partially_fulfilled: "Envio parcial", partially_packed: "Embalagem parcial" };
const PAGE_SIZE = 50;

export default function OrdersPage() {
  const router = useRouter();
  const orders = usePreparationStore(state => state.nuvemshopOrders);
  const selectedIds = usePreparationStore(state => state.selectedIds);
  const confirmedAt = usePreparationStore(state => state.confirmedAt);
  const [connected, setConnected] = useState(false);
  const [from, setFrom] = useState(() => saoPauloDate());
  const [to, setTo] = useState(() => saoPauloDate());
  const [mode, setMode] = useState("updated");
  const [search, setSearch] = useState("");
  const [payment, setPayment] = useState("paid");
  const [shipping, setShipping] = useState("");
  const [onlySelected, setOnlySelected] = useState(false);
  const [sort, setSort] = useState("number-desc");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const anchor = useRef<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);
  useEffect(() => { setPage(1); anchor.current = null; }, [search, payment, shipping, onlySelected, sort]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const filtered = useMemo(() => orders.filter(order => (!payment || order.paymentStatus === payment) && (!shipping || order.shippingStatus === shipping)
    && (!onlySelected || selected.has(order.id)) && searchText(`${order.number} ${order.id} ${order.clientName}`).includes(searchText(search)))
    .sort((a, b) => sort === "name" ? a.clientName.localeCompare(b.clientName, "pt-BR") : sort === "created-desc" ? b.createdAt.localeCompare(a.createdAt) : b.number.localeCompare(a.number, undefined, { numeric: true })), [orders, payment, shipping, onlySelected, selected, search, sort]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const eligible = (order: NuvemshopOrder) => order.status !== "cancelled" && order.paymentStatus === "paid";
  const eligibleFiltered = filtered.filter(eligible).map(order => order.id);
  const allFilteredSelected = eligibleFiltered.length > 0 && eligibleFiltered.every(id => selected.has(id));
  const hiddenCount = selectedIds.filter(id => !filtered.some(order => order.id === id)).length;
  const toggle = (order: NuvemshopOrder, shift: boolean) => {
    if (busy || !eligible(order)) return;
    usePreparationStore.getState().setSelectedIds(toggleOrderSelection(selectedIds, visible.filter(eligible).map(item => item.id), order.id, anchor.current, shift));
    if (!shift || anchor.current === null) anchor.current = order.id;
  };
  const fetchOrders = async () => {
    if (!isValidDateRange(from, to)) { setError("Informe um período válido de até 31 dias."); return; }
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller;
    setBusy(true); setLoaded(0); setError(null); usePreparationStore.getState().invalidateSelection();
    try {
      const collected = new Map<number, NuvemshopOrder>();
      let nextPage = 1;
      let retries = 0;
      while (true) {
        const query = new URLSearchParams({ from, to, mode, page: String(nextPage) });
        const response = await fetch(`/api/nuvemshop/orders?${query}`, { signal: controller.signal, cache: "no-store" });
        const data = await response.json();
        if (response.status === 429 && retries++ < 5) {
          const seconds = Math.min(300, Math.max(1, Number(data.retryAfterSeconds) || 30));
          setError(`Limite de consultas. Retomando em ${seconds} segundos…`);
          await new Promise(resolve => setTimeout(resolve, seconds * 1000));
          controller.signal.throwIfAborted();
          continue;
        }
        if (!response.ok) throw new Error(data.error || "Não foi possível consultar os pedidos.");
        retries = 0;
        setError(null);
        if (!Array.isArray(data.orders)) throw new Error("Resposta inválida da consulta.");
        for (const order of data.orders) collected.set(order.id, order);
        setLoaded(collected.size);
        if (!data.hasMore) break;
        if (nextPage >= 100) throw new Error("Este período ultrapassa 10.000 pedidos. Reduza as datas para carregar uma lista completa.");
        nextPage++;
        await new Promise(resolve => setTimeout(resolve, 600));
        controller.signal.throwIfAborted();
      }
      usePreparationStore.getState().setNuvemshopOrders([...collected.values()]); setPage(1); anchor.current = null;
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Falha na consulta."); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  return <>
    <Header title="Pedidos Nuvemshop" subtitle="Selecione os pedidos preparados para o lote de hoje" breadcrumbs={["Abelha Par", "Pedidos Nuvemshop"]} />
    <NuvemshopConnection onConnected={setConnected} />
    <section className="card p-5 sm:p-6 mb-5">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end">
        <label className="text-sm">Buscar por<select className="field mt-1" value={mode} onChange={event => setMode(event.target.value)}><option value="updated">Data de atualização</option><option value="created">Data de criação</option></select></label>
        <label className="text-sm">De<input className="field mt-1" type="date" value={from} max={to} onChange={event => setFrom(event.target.value)} /></label>
        <label className="text-sm">Até<input className="field mt-1" type="date" value={to} min={from} onChange={event => setTo(event.target.value)} /></label>
        <button onClick={fetchOrders} disabled={!connected || busy} className="btn-primary h-[44px]"><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />{busy ? `${loaded} carregados…` : "Buscar pedidos"}</button>
      </div>
      <p className="mt-3 text-xs text-[var(--color-text-secondary)]">A data de atualização inclui pagamentos confirmados depois da criação. Amplie o período para selecionar pedidos antigos preparados hoje.</p>
      {error && <p role="alert" className="mt-3 text-sm text-[var(--color-accent-red)]">{error} A seleção precisa de uma consulta completa para ser confirmada.</p>}
    </section>
    <section className="card overflow-hidden">
      <div className="p-5 space-y-4 border-b border-[var(--color-border-light)]">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-lg">Sua seleção do dia</h2><p className="text-sm text-[var(--color-text-secondary)]">{orders.length} carregados · {filtered.length} no filtro · {selectedIds.length} selecionados</p></div><span className="badge badge-pending">Shift + clique para selecionar um intervalo</span></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="relative"><span className="sr-only">Pesquisar pedidos</span><Search className="absolute left-3 top-3.5 w-4 h-4 text-[var(--color-text-tertiary)]" /><input className="field !pl-9" placeholder="Pedido, cliente ou ID" value={search} onChange={event => setSearch(event.target.value)} /></label>
          <label><span className="sr-only">Filtrar pagamento</span><select className="field" value={payment} onChange={event => setPayment(event.target.value)}><option value="">Todos os pagamentos</option>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label><span className="sr-only">Filtrar envio</span><select className="field" value={shipping} onChange={event => setShipping(event.target.value)}><option value="">Todos os envios</option>{[...new Set(orders.map(order => order.shippingStatus))].filter(Boolean).map(value => <option key={value} value={value}>{shippingLabels[value] || value}</option>)}</select></label>
          <label><span className="sr-only">Ordenar pedidos</span><select className="field" value={sort} onChange={event => setSort(event.target.value)}><option value="number-desc">Número: maior primeiro</option><option value="created-desc">Criação: mais recente</option><option value="name">Cliente: A–Z</option></select></label>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={allFilteredSelected} disabled={busy || !eligibleFiltered.length} onChange={() => { const next = new Set(selectedIds); for (const id of eligibleFiltered) { if (allFilteredSelected) next.delete(id); else next.add(id); } usePreparationStore.getState().setSelectedIds([...next]); anchor.current = null; }} />Selecionar todos os aptos do filtro ({eligibleFiltered.length})</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={onlySelected} onChange={event => setOnlySelected(event.target.checked)} />Só selecionados</label>
          <button className="text-[var(--color-accent-blue)] hover:underline disabled:opacity-40" disabled={!selectedIds.length || busy} onClick={() => usePreparationStore.getState().setSelectedIds([])}>Limpar seleção</button>
        </div>
        {hiddenCount > 0 && <p className="text-xs text-[var(--color-accent-orange)]">{hiddenCount} pedido(s) selecionado(s) estão fora do filtro atual e continuam no lote.</p>}
      </div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-[var(--color-bg-primary)] text-left text-[var(--color-text-secondary)]"><tr><th className="p-3 w-10"><span className="sr-only">Seleção</span></th><th className="p-3">Pedido / cliente</th><th className="p-3">Criação</th><th className="p-3">Pagamento</th><th className="p-3">Envio</th><th className="p-3 text-right">Valor</th></tr></thead><tbody>
        {visible.map(order => <tr key={order.id} onClick={event => toggle(order, event.shiftKey)} className={`border-t border-[var(--color-border-light)] select-none ${eligible(order) ? "cursor-pointer hover:bg-[var(--color-accent-yellow)]/10" : "opacity-60"} ${selected.has(order.id) ? "bg-[var(--color-accent-yellow)]/15" : ""}`}>
          <td className="p-3"><input aria-label={`Selecionar pedido ${order.number}`} type="checkbox" checked={selected.has(order.id)} disabled={busy || !eligible(order)} onChange={() => {}} onClick={event => { event.stopPropagation(); toggle(order, event.shiftKey); }} /></td>
          <td className="p-3"><p className="font-semibold">#{order.number} <span className="font-normal text-[var(--color-text-secondary)]">{order.clientName || "Cliente não informado"}</span></p><p className="text-xs text-[var(--color-text-tertiary)]">ID {order.id}{order.status === "cancelled" ? " · Cancelado" : ""}</p></td>
          <td className="p-3 whitespace-nowrap">{new Date(order.createdAt).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</td>
          <td className="p-3"><span className={`badge ${order.paymentStatus === "paid" ? "badge-checked" : "badge-pending"}`}>{paymentLabels[order.paymentStatus] || order.paymentStatus}</span></td>
          <td className="p-3 whitespace-nowrap">{shippingLabels[order.shippingStatus] || order.shippingStatus || "—"}</td>
          <td className="p-3 text-right whitespace-nowrap">{order.currency} {Number(order.total).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        </tr>)}
        {!visible.length && <tr><td colSpan={6} className="p-12 text-center text-[var(--color-text-secondary)]">{orders.length ? "Nenhum pedido corresponde aos filtros." : "Busque os pedidos da Nuvemshop para montar sua seleção."}</td></tr>}
      </tbody></table></div>
      <div className="p-4 flex items-center justify-between border-t border-[var(--color-border-light)] text-sm"><button className="btn-ghost" disabled={currentPage === 1} onClick={() => { setPage(currentPage - 1); anchor.current = null; }}>Anterior</button><span>Página {currentPage} de {pages}</span><button className="btn-ghost" disabled={currentPage === pages} onClick={() => { setPage(currentPage + 1); anchor.current = null; }}>Próxima</button></div>
    </section>
    <div className="sticky bottom-20 lg:bottom-4 z-20 card-elevated mt-5 p-4 flex flex-wrap items-center justify-between gap-3">
      <div><p className="font-semibold">{selectedIds.length} pedidos para conferir</p><p className="text-xs text-[var(--color-text-secondary)]">{confirmedAt ? "Seleção confirmada. Você pode continuar para o cruzamento." : "A confirmação substitui a lista usada pela antiga planilha."}</p></div>
      <button className="btn-success" disabled={!connected || busy || Boolean(error) || !selectedIds.length || selectedIds.length > 1000} onClick={() => { usePreparationStore.getState().confirmSelection(); router.push("/"); }}><Check className="w-4 h-4" />Confirmar seleção<ArrowRight className="w-4 h-4" /></button>
    </div>
  </>;
}
