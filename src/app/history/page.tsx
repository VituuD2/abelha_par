"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { BatchTable } from "@/components/history/batch-table";
import type { Batch } from "@/types";
import { motion } from "framer-motion";
import { Clock, RefreshCw, Search, X } from "lucide-react";

export default function HistoryPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [search, setSearch] = useState({ query: "", page: 1 });
  const [total, setTotal] = useState(0);
  const [matchingOrders, setMatchingOrders] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const waiting = input.trim() !== search.query;
  const loading = isLoading || waiting;
  const pages = Math.max(1, Math.ceil(total / 20));

  useEffect(() => {
    if (input.trim() === search.query) return;
    const timer = setTimeout(() => {
      setIsLoading(true);
      setSearch({ query: input.trim(), page: 1 });
    }, 300);
    return () => clearTimeout(timer);
  }, [input, search.query]);

  useEffect(() => {
    const abort = new AbortController();
    setIsLoading(true);
    setError(null);
    setBatches([]);
    const load = async () => {
      try {
        const params = new URLSearchParams({ page: String(search.page) });
        if (search.query) params.set("q", search.query);
        const response = await fetch(`/api/batches?${params}`, { cache: "no-store", signal: abort.signal });
        const payload = await response.json().catch(() => ({}));
        if (abort.signal.aborted) return;
        if (!response.ok) {
          throw new Error(payload.error || "Não foi possível carregar o histórico.");
        }
        setBatches(payload.batches || []);
        setTotal(payload.total || 0);
        setMatchingOrders(payload.matchingOrders || 0);
      } catch (err) {
        if (abort.signal.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : "Erro ao carregar histórico. Verifique a conexão com o Supabase."
        );
      } finally {
        if (!abort.signal.aborted) setIsLoading(false);
      }
    };
    void load();
    return () => abort.abort();
  }, [search, refresh]);

  return (
    <>
      <Header
        title="Favos de Mel"
        subtitle="Encontre pedidos conferidos e consulte os lotes finalizados."
        breadcrumbs={["Abelha Par", "Favos de Mel"]}
      />

      {/* Refresh Button */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card p-4 sm:p-5 flex items-center justify-between mb-5"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-accent-blue)]/10 flex items-center justify-center">
            <Clock className="w-5 h-5 text-[var(--color-accent-blue)]" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">
              {loading ? "Consultando histórico…" : error ? "Histórico indisponível" : search.query
                ? `${matchingOrders} pedido${matchingOrders !== 1 ? "s" : ""} em ${total} lote${total !== 1 ? "s" : ""}`
                : `${total} lote${total !== 1 ? "s" : ""} registrado${total !== 1 ? "s" : ""}`}
            </p>
            <p className="text-[12px] text-[var(--color-text-tertiary)]">
              Dados salvos no Supabase
            </p>
          </div>
        </div>
        <button
          onClick={() => setRefresh(value => value + 1)}
          disabled={loading}
          className="btn-ghost text-[13px] px-3 sm:px-4"
        >
          <RefreshCw
            className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
          />
          Atualizar
        </button>
      </motion.div>

      <form className="card p-4 sm:p-5 mb-5 space-y-2" role="search" onSubmit={event => {
        event.preventDefault();
        setBatches([]);
        setIsLoading(true);
        setSearch({ query: input.trim(), page: 1 });
      }}>
        <label htmlFor="history-search" className="text-sm font-medium">Buscar pedido conferido</label>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search aria-hidden="true" className="absolute left-3 top-3.5 w-4 h-4 text-[var(--color-text-tertiary)]" />
            <input id="history-search" type="search" value={input} maxLength={200}
              onChange={event => setInput(event.target.value)} aria-describedby="history-search-hint"
              placeholder="Número do pedido, nome do cliente ou rastreio"
              className="field w-full [&::-webkit-search-cancel-button]:appearance-none" style={{ paddingLeft: 40, paddingRight: 40 }} />
            {!!input && <button type="button" aria-label="Limpar busca" className="absolute right-3 top-3.5" onClick={() => {
              setInput(""); setBatches([]); setIsLoading(true); setSearch({ query: "", page: 1 });
            }}><X className="w-4 h-4" /></button>}
          </div>
          <button type="submit" className="btn-primary">Buscar</button>
        </div>
        <p id="history-search-hint" className="text-xs text-[var(--color-text-secondary)]">Pesquisa em todos os lotes finalizados, inclusive os mais antigos.</p>
      </form>

      {/* Content */}
      {loading ? (
        <div className="space-y-3" role="status" aria-label="Buscando pedidos">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="card p-8 text-center"
        >
          <p role="alert" className="text-[14px] text-[var(--color-accent-red)] mb-3">
            {error}
          </p>
          <button onClick={() => setRefresh(value => value + 1)} className="btn-primary">
            Tentar novamente
          </button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div aria-live="polite" className="sr-only">{search.query ? `${matchingOrders} pedidos encontrados` : `${total} lotes registrados`}</div>
          <BatchTable key={`${search.query}:${search.page}`} batches={batches} searching={!!search.query} />
          {total > 20 && <nav aria-label="Páginas do histórico" className="flex items-center justify-between gap-3 mt-5 text-sm">
            <span>Página {search.page} de {pages}</span>
            <div className="flex gap-2">
              <button type="button" className="btn-ghost" disabled={search.page <= 1} onClick={() => {
                setIsLoading(true); setSearch(current => ({ ...current, page: current.page - 1 }));
              }}>Anterior</button>
              <button type="button" className="btn-ghost" disabled={search.page >= pages} onClick={() => {
                setIsLoading(true); setSearch(current => ({ ...current, page: current.page + 1 }));
              }}>Próxima</button>
            </div>
          </nav>}
        </motion.div>
      )}
    </>
  );
}
