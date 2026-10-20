"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  RefreshCw,
  X,
} from "lucide-react";
import {
  ABC_DEFAULTS,
  DIMENSIONS,
  ORDER_STATUSES,
} from "@/lib/analytics/config";
import { type CoverageJob } from "@/lib/analytics/coverage";
import { reportReliability } from "@/lib/analytics/reliability";
import { ConnectionProgress } from "./connection-progress";
import { ParetoChart } from "./pareto-chart";
import { money, number, pct } from "@/lib/analytics/format";
import { paretoHighlighted, type ParetoHighlight } from "@/lib/analytics/pareto";
import { progressVersion } from "@/lib/analytics/progress";
import type {
  ABCFilters,
  ABCResult,
  ABCRow,
  Dimension,
  Option,
  CostSyncStatus,
} from "@/lib/analytics/types";

type Status = {
  costSync?: CostSyncStatus | null;
  coverage?: CoverageJob[];
  companies: { id: string; name: string; tax_id: string | null }[];
  sources?: { id: string; connection_id: string }[];
  connections: {
    id: string;
    company_id: string;
    name: string;
    enabled: boolean;
    verified_at: string | null;
    last_synced_at: string | null;
    last_error: string | null;
  }[];
  jobs: (CoverageJob & { processed: number; last_error: string | null; cursor_date?: string; page_offset?: number; pending_index?: number })[];
  options: Partial<Record<Dimension, Option[]>>;
};
type Drill = {
  total: number;
  sources?: { sku: string; name: string; factor: string; quantity: string; baseQuantity: string; revenue: string; originalRevenue: string; referenceCostCents: string | null; unallocatedLines: number; ignoredComponents?: string[]; costVersions?: number; minReferenceCostCents?: string; maxReferenceCostCents?: string }[];
  companies: {
    name: string;
    revenue: string;
    quantity: string;
    orders: number;
  }[];
  channels: {
    name: string;
    revenue: string;
    quantity: string;
    orders: number;
  }[];
  orders: {
    id: string;
    number: string;
    date: string;
    status: number;
    company: string;
    source: string;
    connection: string;
    revenue: string;
    quantity: string;
  }[];
};
const labels = {
  rank: "Posição",
  sku: "SKU",
  name: "Produto / cliente",
  quantity: "Quantidade",
  revenue: "Valor bruto",
  percent: "% individual",
  cumulative: "% acumulado",
  orders: "Pedidos",
  class: "Classe",
};
type Column = keyof typeof labels;
function today() {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Sao_Paulo",
  }).format(new Date());
}
function dayBefore(day: string, n: number) {
  return new Date(Date.parse(day + "T12:00:00Z") - n * 86400000)
    .toISOString()
    .slice(0, 10);
}
export { money } from "@/lib/analytics/format";
async function jsonRequest(path: string, body?: unknown, signal?: AbortSignal) {
  const response = await fetch(
    path,
    body === undefined
      ? { cache: "no-store", signal }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Não foi possível consultar os dados.");
  return data;
}
function MultiFilter({
  dimension,
  options,
  selected,
  onChange,
}: {
  dimension: Dimension;
  options: Option[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [remote, setRemote] = useState<Option[] | null>(null),
    [searchError, setSearchError] = useState(false);
  useEffect(() => {
    setRemote(null);
    setSearchError(false);
    if (!search || dimension === "statuses") return;
    const abort = new AbortController(),
      timer = setTimeout(() => {
        jsonRequest(
          `/api/analytics/options?dimension=${dimension}&q=${encodeURIComponent(search)}`,
          undefined,
          abort.signal,
        )
          .then((data) => setRemote(data[dimension] || []))
          .catch((e) => {
            if (!abort.signal.aborted && e.name !== "AbortError") setSearchError(true);
          });
      }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [dimension, search]);
  const choices = remote || options;
  return (
    <details className="rounded-xl border border-[var(--color-border-light)] p-3 bg-white/70">
      <summary className="cursor-pointer text-sm font-medium">
        {DIMENSIONS[dimension]}{" "}
        <span className="text-[var(--color-text-secondary)]">
          · {selected.length || "Todos"}
        </span>
      </summary>
      {options.length ? (
        <div className="mt-3 space-y-2">
          <input
            aria-label={`Buscar em ${DIMENSIONS[dimension]}`}
            className="field text-sm"
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className="text-xs text-amber-800 underline"
            onClick={() =>
              onChange(
                dimension === "statuses" ? options.map((o) => o.value) : [],
              )
            }
          >
            Selecionar todos
          </button>
          <div className="max-h-40 overflow-y-auto space-y-2">
            {choices
              .filter((o) =>
                o.label
                  .toLocaleLowerCase()
                  .includes(search.toLocaleLowerCase()),
              )
              .map((o) => (
                <label key={o.value} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 accent-amber-600"
                    checked={selected.includes(o.value)}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...selected, o.value]
                          : selected.filter((v) => v !== o.value),
                      )
                    }
                  />
                  {dimension === "statuses"
                    ? ORDER_STATUSES[Number(o.value)] || o.label
                    : o.label}
                </label>
              ))}
          </div>
          {options.length >= 200 && (
            <p className="text-xs">
              Exibindo até 200 opções. Busque no servidor para encontrar outras.
            </p>
          )}
          {searchError && (
            <p role="status" className="text-xs text-red-800">
              Busca temporariamente indisponível.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
          Sem valores importados. Este campo depende da resposta da API ou da
          classificação de origem no Ninho.
        </p>
      )}
    </details>
  );
}

export function ABCDashboard({ isAdmin, initialGrouping = "product" }: { isAdmin: boolean; initialGrouping?: "composition" | "product" }) {
  const [draft, setDraft] = useState<ABCFilters>(() => ({
    from: dayBefore(today(), 29),
    to: today(),
    metric: "revenue",
    mode: ABC_DEFAULTS.mode,
    grouping: initialGrouping,
    thresholdA: ABC_DEFAULTS.thresholdA,
    thresholdB: ABC_DEFAULTS.thresholdB,
    basis: "orders",
    costBasis: "average",
    selections: { statuses: ABC_DEFAULTS.statuses.map(String) },
  }));
  const [filters, setFilters] = useState(draft),
    [status, setStatus] = useState<Status | null>(null),
    [result, setResult] = useState<ABCResult | null>(null);
  const [highlight, setHighlight] = useState<ParetoHighlight | null>(null);
  const highlightRow = result?.pareto.find(row => row.entityId === highlight?.entityId) || result?.rows.find(row => row.entityId === highlight?.entityId) || null;
  const updateHighlight = (next: ParetoHighlight | null) => setHighlight(current =>
    current?.entityId === next?.entityId && current?.cumulative === next?.cumulative && current?.origin === next?.origin && current?.targetPercentage === next?.targetPercentage ? current : next);
  const [error, setError] = useState<string | null>(null),
    [schedulingError, setSchedulingError] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [page, setPage] = useState(1),
    [size, setSize] = useState(50),
    [sort, setSort] = useState("rank"),
    [direction, setDirection] = useState("asc"),
    [refresh, setRefresh] = useState(0),
    [dataRefresh, setDataRefresh] = useState(0);
  const [columns, setColumns] = useState<Column[]>(
      Object.keys(labels) as Column[],
    ),
    [entity, setEntity] = useState<ABCRow | null>(null),
    [drill, setDrill] = useState<Drill | null>(null),
    [drillPage, setDrillPage] = useState(1),
    [drillError, setDrillError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const resultScope = useRef("");
  const scheduledFilters = useRef("");
  const statusSequence = useRef(0);
  const lastProgress = useRef("");
  const optionsLoadedAt = useRef(0);
  const reportSequence = useRef(0);
  const reportRunning = useRef(false);
  const pendingProgressRefresh = useRef<"all" | "data" | null>(null);
  const refreshFromProgress = useCallback((includeOptions: boolean) => {
    if (reportRunning.current) {
      if (includeOptions || pendingProgressRefresh.current !== "all")
        pendingProgressRefresh.current = includeOptions ? "all" : "data";
      return;
    }
    if (includeOptions) setRefresh(value => value + 1);
    else setDataRefresh(value => value + 1);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    const sequence = ++statusSequence.current;
    jsonRequest("/api/analytics/options", undefined, abort.signal)
      .then((data) => {
        if (abort.signal.aborted) return;
        optionsLoadedAt.current = Date.now();
        if (sequence === statusSequence.current) {
          lastProgress.current = progressVersion(data);
          setStatus(data);
        } else {
          // A status read after scheduling may be newer than these filter options.
          setStatus((current) => current ? { ...current, options: data.options } : data);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted && e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, [refresh]);
  useEffect(() => {
    const filterScope = JSON.stringify(filters);
    setSchedulingError(null);
    if (scheduledFilters.current === filterScope) return;
    const abort = new AbortController();
    // Existing sales can be displayed while durable history is being scheduled.
    jsonRequest("/api/analytics/coverage", { filters }, abort.signal)
      .then(async (data) => {
        if (abort.signal.aborted) return;
        if (data.sync?.error) throw new Error(data.sync.error);
        scheduledFilters.current = filterScope;
        const sequence = ++statusSequence.current;
        const next = await jsonRequest("/api/analytics/sync", undefined, abort.signal);
        if (abort.signal.aborted || sequence !== statusSequence.current) return;
        lastProgress.current = progressVersion(next);
        setStatus(current => ({ ...next, options: current?.options || {} }));
      })
      .catch((reason) => {
        if (!abort.signal.aborted && reason.name !== "AbortError") setSchedulingError(reason.message);
      });
    return () => abort.abort();
  }, [filters, refresh]);
  useEffect(() => {
    const abort = new AbortController();
    const sequence = ++reportSequence.current;
    reportRunning.current = true;
    pendingProgressRefresh.current = null;
    const scope = JSON.stringify({ filters, page, size, sort, direction });
    if (resultScope.current !== scope) {
      setResult(null);
      resultScope.current = scope;
    }
    setLoading(true);
    setError(null);
    jsonRequest(
      "/api/analytics/abc",
      { filters, page, size, sort, direction, ensureCoverage: false },
      abort.signal,
    )
      .then((data) => {
        if (!abort.signal.aborted) {
          setResult(data);
          if (data.sync?.error) setError(data.sync.error);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted && e.name !== "AbortError") {
          setError(e.message);
          setResult(null);
        }
      })
      .finally(() => {
        if (abort.signal.aborted || sequence !== reportSequence.current) return;
        reportRunning.current = false;
        setLoading(false);
        const pending = pendingProgressRefresh.current;
        pendingProgressRefresh.current = null;
        if (pending) refreshFromProgress(pending === "all");
      });
    return () => {
      abort.abort();
      // React cleans this effect up before starting the next report effect.
      reportRunning.current = false;
      pendingProgressRefresh.current = null;
    };
  }, [filters, page, size, sort, direction, refresh, dataRefresh, refreshFromProgress]);
  // Poll local progress only. The cron owns every provider request, including costs.
  const pendingImports = status?.jobs.some((j) => ["queued", "running", "retry"].includes(j.status)) ||
    (filters.grouping === "composition" && !!status?.costSync?.connection_id);
  useEffect(() => {
    if (!pendingImports) return;
    const abort = new AbortController();
    let reading = false;
    const poll = async () => {
      if (reading || document.visibilityState === "hidden") return;
      reading = true;
      const sequence = ++statusSequence.current;
      try {
        const next = await jsonRequest("/api/analytics/sync", undefined, abort.signal);
        if (abort.signal.aborted || sequence !== statusSequence.current) return;
        const version = progressVersion(next);
        const changed = version !== lastProgress.current;
        lastProgress.current = version;
        setStatus((current) => ({ ...next, options: current?.options || {} }));
        if (changed) {
          refreshFromProgress(Date.now() - optionsLoadedAt.current >= 60000 ||
            !next.jobs.some((j: CoverageJob) => ["queued", "running", "retry"].includes(j.status)));
        }
      } catch (reason) {
        if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Progresso indisponível.");
      } finally { reading = false; }
    };
    const timer = setInterval(poll, 15000);
    return () => { clearInterval(timer); abort.abort(); };
  }, [pendingImports, refreshFromProgress]);
  useEffect(() => {
    if (!entity) return;
    const abort = new AbortController();
    setDrill(null);
    setDrillError(null);
    jsonRequest(
      "/api/analytics/drilldown",
      { filters, entity: entity.entityId, page: drillPage },
      abort.signal,
    )
      .then((data) => {
        if (!abort.signal.aborted) setDrill(data);
      })
      .catch((e) => {
        if (!abort.signal.aborted && e.name !== "AbortError") setDrillError(e.message);
      });
    return () => abort.abort();
  }, [entity, drillPage, filters]);
  const reliability = status ? reportReliability(status, filters) : null;
  const selectedConnections = reliability?.connections || [];
  const companies = reliability?.companies || [];
  const incomplete = !reliability?.complete;
  const select = (dimension: Dimension, values: string[]) =>
    setDraft((f) => ({
      ...f,
      selections: { ...f.selections, [dimension]: values },
    }));
  const download = useCallback(
    async (format: "csv" | "xlsx") => {
      setExporting(true);
      setError(null);
      try {
        const response = await fetch("/api/analytics/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filters, format }),
        });
        if (!response.ok) throw new Error((await response.json()).error);
        const url = URL.createObjectURL(await response.blob()),
          a = document.createElement("a");
        a.href = url;
        a.download = `curva-abc-${filters.from}-${filters.to}.${format}`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Falha ao exportar.");
      } finally {
        setExporting(false);
      }
    },
    [filters],
  );
  const openEntity = (row: ABCRow) => {
    setEntity(row);
    setDrillPage(1);
    dialog.current?.showModal();
  };
  const cell = (row: ABCRow, column: Column) =>
    column === "revenue" ? (
      money(row.revenue)
    ) : column === "quantity" ? (
      number(row.quantity)
    ) : column === "percent" || column === "cumulative" ? (
      pct(row[column])
    ) : column === "class" ? (
      <span
        className={`px-2.5 py-1 rounded-full font-semibold ${row.class === "A" ? "bg-amber-100 text-amber-900" : row.class === "B" ? "bg-yellow-100 text-yellow-900" : "bg-stone-100 text-stone-600"}`}
      >
        {row.class}
      </span>
    ) : column === "name" ? (
      <button
        className="font-medium text-left hover:underline underline-offset-4"
        onClick={() => openEntity(row)}
      >
        {row.name}
      </button>
    ) : (
      row[column]
    );
  return (
    <div className="space-y-6 max-w-[1240px] mx-auto pb-6">
      <section className="card p-5 sm:p-6 bg-gradient-to-r from-amber-100/60 to-white space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">
              Onde estão as vendas da sua operação?
            </h2>
            <p className="text-sm mt-2 text-[var(--color-text-secondary)]">
              Combine empresas e origens. Compare os registros Olist ou consolide
              kits com regras de composição confirmadas.
            </p>
          </div>
          <button
            className="btn-ghost"
            onClick={() => setRefresh((v) => v + 1)}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </button>
        </div>
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Análises">
          <button
            role="tab"
            aria-selected={draft.grouping === "product" || draft.grouping === "parent"}
            className={
              draft.grouping === "product" || draft.grouping === "parent" ? "btn-primary" : "btn-ghost"
            }
            onClick={() => {
              setDraft((f) => ({ ...f, grouping: "product" }));
              setFilters((f) => ({ ...f, grouping: "product" }));
              setPage(1);
            }}
          >
            Produtos Olist
          </button>
          <button
            role="tab"
            aria-selected={draft.grouping === "composition"}
            className={draft.grouping === "composition" ? "btn-primary" : "btn-ghost"}
            onClick={() => {
              setDraft(f => ({ ...f, grouping: "composition" }));
              setFilters(f => ({ ...f, grouping: "composition" }));
              setHighlight(null);
              setPage(1);
            }}
          >Produtos base</button>
          <button
            role="tab"
            aria-selected={draft.grouping === "customer"}
            className={
              draft.grouping === "customer" ? "btn-primary" : "btn-ghost"
            }
            onClick={() => {
              setDraft((f) => ({ ...f, grouping: "customer" }));
              setFilters((f) => ({ ...f, grouping: "customer" }));
              setPage(1);
            }}
          >
            Clientes
          </button>
        </div>
        {(filters.grouping === "product" || filters.grouping === "parent") && <p className="text-sm text-stone-600">Produtos Olist apresenta os cadastros por conta. Para somar vendas diretas e kits nos produtos simples, selecione Produtos base.</p>}
      </section>
      <form
        className="card p-5 sm:p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilters({ ...draft });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm font-medium">
            De
            <input
              required
              type="date"
              className="field mt-2"
              value={draft.from}
              max={draft.to}
              onChange={(e) =>
                setDraft((f) => ({ ...f, from: e.target.value }))
              }
            />
          </label>
          <label className="text-sm font-medium">
            Até
            <input
              required
              type="date"
              className="field mt-2"
              value={draft.to}
              min={draft.from}
              onChange={(e) => setDraft((f) => ({ ...f, to: e.target.value }))}
            />
          </label>
          <label className="text-sm font-medium">
            Métrica
            <select
              className="field mt-2"
              value={draft.metric}
              onChange={(e) =>
                setDraft((f) => ({
                  ...f,
                  metric: e.target.value as ABCFilters["metric"],
                }))
              }
            >
              <option value="revenue">Valor bruto dos itens</option>
              <option value="quantity">Quantidade vendida</option>
            </select>
          </label>
          <label className="text-sm font-medium">
            Base
            <select
              className="field mt-2"
              value={draft.basis}
              onChange={(e) =>
                setDraft((f) => ({
                  ...f,
                  basis: e.target.value as ABCFilters["basis"],
                }))
              }
            >
              <option value="orders">Pedidos · data da venda</option>
              <option value="invoiced">
                Pedidos com NF autorizada · emissão
              </option>
            </select>
          </label>
          {draft.grouping === "composition" && <label className="text-sm font-medium">
            Base do CMV histórico
            <select className="field mt-2" value={draft.costBasis || "average"} onChange={e => setDraft(f => ({ ...f, costBasis: e.target.value as ABCFilters["costBasis"] }))}>
              <option value="average">Custo médio por vigência</option>
              <option value="purchase">Custo de compra por vigência</option>
            </select>
          </label>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[7, 30, 90, 365].map((n) => (
            <button
              type="button"
              key={n}
              className="btn-ghost text-xs"
              onClick={() =>
                setDraft((f) => ({
                  ...f,
                  from: dayBefore(today(), n - 1),
                  to: today(),
                }))
              }
            >
              Últimos {n} dias
            </button>
          ))}
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() =>
              setDraft((f) => ({
                ...f,
                from: today().slice(0, 8) + "01",
                to: today(),
              }))
            }
          >
            Este mês
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() =>
              setDraft((f) => ({
                ...f,
                from: today().slice(0, 4) + "-01-01",
                to: today(),
              }))
            }
          >
            Este ano
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(
            ["companies", "connections", "sources", "statuses"] as Dimension[]
          ).map((dim) => (
            <MultiFilter
              key={dim}
              dimension={dim}
              options={
                dim === "statuses"
                  ? Object.entries(ORDER_STATUSES)
                      .filter(([key]) => key !== "2")
                      .map(([value, label]) => ({ value, label }))
                  : status?.options[dim] || []
              }
              selected={draft.selections[dim] || []}
              onChange={(v) => select(dim, v)}
            />
          ))}
        </div>
        <button
          type="button"
          className="btn-ghost"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
        >
          <Filter className="w-4 h-4" />
          Filtros e regras adicionais
        </button>
        {advanced && (
          <div className="space-y-4 border-t border-[var(--color-border-light)] pt-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(Object.keys(DIMENSIONS) as Dimension[])
                .filter(
                  (dim) =>
                    ![
                      "companies",
                      "connections",
                      "sources",
                      "statuses",
                    ].includes(dim),
                )
                .map((dim) => (
                  <MultiFilter
                    key={dim}
                    dimension={dim}
                    options={status?.options[dim] || []}
                    selected={draft.selections[dim] || []}
                    onChange={(v) => select(dim, v)}
                  />
                ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-sm">
                Regra ABC
                <select
                  className="field mt-2"
                  value={draft.mode}
                  onChange={(e) =>
                    setDraft((f) => ({
                      ...f,
                      mode: e.target.value as ABCFilters["mode"],
                    }))
                  }
                >
                  <option value="TINY_LEGACY">
                    Tiny histórico · acumulado anterior
                  </option>
                  <option value="STRICT_CUMULATIVE">
                    Estrito · acumulado após a linha
                  </option>
                </select>
              </label>
              <label className="text-sm">
                Limite A (%)
                <input
                  required
                  type="number"
                  min="0.01"
                  max={draft.thresholdB - 0.01}
                  step="0.01"
                  className="field mt-2"
                  value={draft.thresholdA}
                  onChange={(e) =>
                    setDraft((f) => ({
                      ...f,
                      thresholdA: Number(e.target.value),
                    }))
                  }
                />
              </label>
              <label className="text-sm">
                Limite B (%)
                <input
                  required
                  type="number"
                  min={draft.thresholdA + 0.01}
                  max="99.99"
                  step="0.01"
                  className="field mt-2"
                  value={draft.thresholdB}
                  onChange={(e) =>
                    setDraft((f) => ({
                      ...f,
                      thresholdB: Number(e.target.value),
                    }))
                  }
                />
              </label>
              {draft.grouping !== "customer" && (
                <label className="text-sm">
                  Agrupar produtos
                  <select
                    className="field mt-2"
                    value={draft.grouping}
                    onChange={(e) =>
                      setDraft((f) => ({
                        ...f,
                        grouping: e.target.value as ABCFilters["grouping"],
                      }))
                    }
                  >
                    <option value="product">
                      Registro da empresa / variação
                    </option>
                    <option value="parent">Produto pai documentado</option>
                    <option value="composition">Produto base · composição confirmada</option>
                  </select>
                </label>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Sem produto pai na API, o registro permanece individual. Receita
              líquida após devoluções, CMV e margem exigem dados adicionais e
              não são calculados nesta versão.
            </p>
            <p className="text-xs text-[var(--color-text-secondary)]">
              No modo Tiny histórico, a classe usa o acumulado anterior. No estrito,
              usa o acumulado após a linha: um único produto com 100% fica na classe C.
              Igualdade com 80% ou 95% avança para a classe seguinte.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button className="btn-primary" type="submit" disabled={loading}>
            Analisar vendas
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() =>
              setDraft((f) => ({
                ...f,
                selections: { statuses: ABC_DEFAULTS.statuses.map(String) },
              }))
            }
          >
            Todas as empresas e origens
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={
              !status?.options.sourceKinds?.some(
                (o) => o.value === "marketplace",
              )
            }
            onClick={() =>
              setDraft((f) => ({
                ...f,
                selections: {
                  ...f.selections,
                  sourceKinds: ["marketplace"],
                  marketplaces: [],
                },
              }))
            }
          >
            Todos os marketplaces classificados
          </button>
          <button
            type="button"
            className="btn-ghost"
            disabled={
              !status?.options.sourceKinds?.some((o) => o.value === "site")
            }
            onClick={() =>
              setDraft((f) => ({
                ...f,
                selections: {
                  ...f.selections,
                  sourceKinds: ["site"],
                  marketplaces: [],
                },
              }))
            }
          >
            Somente sites classificados
          </button>
        </div>
      </form>
      {(error || schedulingError) && (
        <div className="card p-5 text-red-800" role="alert">
          {error || schedulingError}
          {isAdmin && (
            <p className="mt-2">
              <Link href="/ninho" className="underline">
                Verificar conexões no Ninho
              </Link>
            </p>
          )}
        </div>
      )}
      {loading && (
        <p role="status" className="text-sm py-4">
          Calculando a Curva ABC…
        </p>
      )}
      {result && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              [result.composition ? "Valor atribuído aos produtos" : "Valor bruto dos itens", money(result.revenue)],
              ["Quantidade vendida", number(result.quantity)],
              [
                "Pedidos / entidades",
                `${number(result.orders)} / ${number(result.total)}`,
              ],
              ["Concentração dos 10 primeiros", pct(result.top10)],
            ].map(([label, value]) => (
              <div key={label} className="card p-5">
                <p className="text-sm text-[var(--color-text-secondary)]">
                  {label}
                </p>
                <p className="text-2xl font-semibold mt-2">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {(["A", "B", "C"] as const).map((cls) => {
              const c = result.classes?.[cls];
              return (
                <div className="card p-5" key={cls}>
                  <p className="font-semibold">
                    Classe {cls} · {number(c?.count || 0)} entidades
                  </p>
                  <p className="text-sm mt-2">
                    {money(c?.revenue || "0")} · {pct(c?.percent || 0)} da
                    métrica
                  </p>
                  <p className="text-xs mt-1 text-[var(--color-text-secondary)]">
                    {number(c?.quantity || "0")} unidades
                  </p>
                </div>
              );
            })}
          </div>
          {result.composition && <section className="card p-5 space-y-3 border-emerald-200 bg-emerald-50/30" aria-label="Regras da consolidação">
            <h2 className="font-semibold">Produtos base · composições confirmadas</h2>
            <p className="text-sm text-stone-600">{result.composition.mappedEntities} produtos base consolidados. Cada combo contribui para os seus componentes nas respectivas unidades de estoque. O valor vendido é dividido proporcionalmente ao CMV de referência × quantidade de cada componente, com ajuste dos centavos residuais.</p>
            <p className="text-xs text-stone-600">CMV de referência: {result.composition.costSource?.name || "Olist 1"}, atualizado automaticamente. {result.composition.costSource?.basis === "purchase" ? "Custo de compra" : "Custo médio"} vigente no dia de cada {filters.basis === "invoiced" ? "emissão da NF" : "venda"}; fechamento diário em São Paulo. Custos posteriores não são aplicados às vendas anteriores. {result.composition.costSource?.lastSyncedAt ? `Históricos sincronizados até: ${new Date(result.composition.costSource.lastSyncedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "Primeira sincronização dos históricos em andamento."}</p>
            {result.composition.periodCostCents != null && <p className="text-sm text-stone-700">Custo de referência das unidades vendidas: <strong>{money(result.composition.periodCostCents)}</strong>. Soma das quantidades × custo histórico aplicável de cada componente.</p>}
            {!!result.composition.costMissingLines && <p className="text-xs text-amber-800">Custo de referência total incompleto: {result.composition.costMissingLines} itens sem custo histórico válido. Parcela conhecida: {money(result.composition.knownCostCents || "0")}. Valores ausentes não são considerados custo zero.</p>}
            {result.composition.costSource?.lastError && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">A atualização do CMV está pendente: {result.composition.costSource.lastError} O relatório usa a última referência disponível.</p>}
            {!!result.composition.unallocatedLines && <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Rateio incompleto: {money(result.composition.unallocatedRevenue)} de {result.composition.unallocatedLines} itens vendidos aguardam CMV de {result.composition.missingCostSkus.join(", ")}. As quantidades dos componentes estão incluídas; os valores desses combos ainda não foram atribuídos aos produtos. Valor original dos itens: {money(result.composition.originalRevenue)}.</p>}
            <p className="text-xs text-stone-500">Filtros de SKU, produto e produto pai selecionam os registros originais da venda antes da consolidação. Regra {result.composition.version}.</p>
            {!!result.composition.ignoredComponentSkus?.length && <p className="text-xs text-stone-600">A Embalagem BelezaFIX é desconsiderada como componente nesta análise. Os SKUs de origem continuam no detalhamento para permitir a separação entre versões com e sem embalagem.</p>}
            {!!result.composition.pendingTotal && <details>
              <summary className="cursor-pointer text-sm font-medium text-amber-900">{result.composition.pendingTotal} SKUs sem vínculo confirmado permanecem separados · revisar composição</summary>
              <ul className="mt-3 space-y-2 text-sm text-stone-600">{result.composition.pending.map(item => <li key={item.sku}><span className="font-mono text-xs font-semibold">{item.sku}</span> · {item.name}<span className="block text-xs text-amber-800">{item.reason} · {item.orders} pedidos</span></li>)}</ul>
              {result.composition.pendingTotal > result.composition.pending.length && <p className="mt-2 text-xs">Primeiros {result.composition.pending.length} SKUs pendentes; a exportação mantém todos os registros no ranking.</p>}
            </details>}
          </section>}
          <ParetoChart
            result={result}
            a={filters.thresholdA}
            b={filters.thresholdB}
            highlight={highlightRow ? highlight : null}
            onHighlight={updateHighlight}
            onOpen={openEntity}
            entityLabel={filters.grouping === "customer" ? "cliente" : "produto"}
          />
          <section className="card overflow-hidden">
            <div className="p-5 space-y-3">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <h2 className="font-semibold">
                  {filters.grouping === "customer" ? "Clientes" : "Produtos"} ·{" "}
                  {number(result.total)} entidades
                </h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    disabled={exporting || !result.total}
                    className="btn-ghost"
                    onClick={() => download("csv")}
                  >
                    <Download className="w-4 h-4" />
                    CSV completo
                  </button>
                  <button
                    disabled={exporting || !result.total}
                    className="btn-ghost"
                    onClick={() => download("xlsx")}
                  >
                    Excel
                  </button>
                </div>
              </div>
              <p className="text-xs text-[var(--color-text-secondary)]">
                Clique no nome para ver empresas, origens e pedidos. A ordenação
                da tabela preserva o ranking e o acumulado ABC.
              </p>
              <details>
                <summary className="text-sm cursor-pointer">
                  Colunas da tabela
                </summary>
                <div className="flex flex-wrap gap-4 mt-3">
                  {(Object.keys(labels) as Column[]).map((c) => (
                    <label key={c} className="text-xs flex gap-2">
                      <input
                        type="checkbox"
                        checked={columns.includes(c)}
                        disabled={c === "name"}
                        onChange={(e) =>
                          setColumns((old) =>
                            e.target.checked
                              ? [...old, c]
                              : old.filter((v) => v !== c),
                          )
                        }
                      />
                      {c === "revenue" && result.composition ? "Valor atribuído" : labels[c]}
                    </label>
                  ))}
                </div>
              </details>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-amber-50/70">
                  <tr>
                    {columns.map((c) => (
                      <th
                        key={c}
                        className="px-4 py-3 whitespace-nowrap"
                        aria-sort={
                          sort === c
                            ? direction === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          disabled={c === "class"}
                          onClick={() => {
                            setSort(c);
                            setDirection(
                              sort === c && direction === "asc"
                                ? "desc"
                                : "asc",
                            );
                            setPage(1);
                          }}
                        >
                          {c === "revenue" && result.composition ? "Valor atribuído" : labels[c]}
                          {sort === c
                            ? direction === "asc"
                              ? " ↑"
                              : " ↓"
                            : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row) => (
                    <tr
                      key={row.entityId}
                      data-abc-entity={row.entityId}
                      data-highlighted={paretoHighlighted(row, highlightRow, !!highlight?.cumulative)}
                      className={`border-t border-[var(--color-border-light)] transition-colors duration-75 motion-reduce:transition-none ${paretoHighlighted(row, highlightRow, !!highlight?.cumulative) ? "bg-amber-100/75 ring-1 ring-inset ring-amber-300" : "hover:bg-amber-50/50"}`}
                      onPointerEnter={() => updateHighlight({ entityId: row.entityId, cumulative: false, origin: "table" })}
                      onPointerLeave={() => { if (highlight?.origin === "table") updateHighlight(null); }}
                      onFocus={() => updateHighlight({ entityId: row.entityId, cumulative: false, origin: "table" })}
                      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && highlight?.origin === "table") updateHighlight(null); }}
                    >
                      {columns.map((c) => (
                        <td
                          key={c}
                          className={`px-4 py-4 ${c === "name" ? "min-w-48" : "whitespace-nowrap tabular-nums"}`}
                        >
                          {cell(row, c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {!result.total && (
                <div className="p-10 text-center">
                  <h3 className="font-semibold">
                    {reliability?.emptyTitle || "Cobertura ainda não verificada"}
                  </h3>
                  <p className="text-sm mt-2 text-[var(--color-text-secondary)]">
                    Confira o período, as situações, as empresas e a cobertura
                    de importação.
                  </p>
                </div>
              )}
            </div>
            <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-light)]">
              <label className="text-xs flex items-center gap-2">
                Por página
                <select
                  className="field w-auto"
                  value={size}
                  onChange={(e) => {
                    setSize(Number(e.target.value));
                    setPage(1);
                  }}
                >
                  {[25, 50, 100].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-3">
                <button
                  aria-label="Página anterior"
                  className="btn-ghost"
                  disabled={page === 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm">
                  {page} / {Math.max(1, Math.ceil(result.total / size))}
                </span>
                <button
                  aria-label="Próxima página"
                  className="btn-ghost"
                  disabled={page * size >= result.total}
                  onClick={() => setPage((v) => v + 1)}
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>
        </>
      )}
      <dialog
        ref={dialog}
        onClose={() => {
          setEntity(null);
          setDrill(null);
        }}
        className="m-auto rounded-3xl bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] p-0 w-[min(960px,94vw)] max-h-[88vh] backdrop:bg-black/40"
      >
        <div className="p-5 sm:p-7 space-y-5">
          <div className="flex justify-between items-center gap-3">
            <h2 className="text-lg font-semibold">{entity?.name}</h2>
            <button
              aria-label="Fechar detalhes"
              className="btn-ghost"
              onClick={() => dialog.current?.close()}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-xs text-[var(--color-text-secondary)]">
            Escopo atual · valores referentes aos itens desta entidade · origem
            rastreável por conexão.
          </p>
          {drillError && (
            <p role="alert" className="text-red-800">
              {drillError}
            </p>
          )}
          {!drill && !drillError && <p role="status">Consultando pedidos…</p>}
          {drill && (
            <>
              {!!drill.sources?.length && <section className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-2">
                <h3 className="font-semibold text-sm">Origem da composição</h3>
                <p className="text-xs text-stone-600">Quantidade vendida × fator = unidades do produto base. Os valores abaixo são atribuídos somente a este produto; o valor original do kit serve para conferência.</p>
                <ul className="space-y-2 text-sm">{drill.sources.map(source => <li key={`${source.sku}:${source.factor}`}><span className="font-mono text-xs">{source.sku || "Sem SKU"}</span> · {source.name}<span className="block text-xs text-stone-600">{number(source.quantity)} × {number(source.factor)} = {number(source.baseQuantity)} un. base · valor atribuído {money(source.revenue)}</span><span className="block text-xs text-stone-500">Valor original dos itens de origem: {money(source.originalRevenue)}{source.referenceCostCents && ` · CMV por unidade base: ${money(source.referenceCostCents)}`}{(source.costVersions || 0) > 1 && ` · CMV variou de ${money(source.minReferenceCostCents || "0")} a ${money(source.maxReferenceCostCents || "0")} no intervalo; rateio calculado por venda`}</span>{!!source.unallocatedLines && <span className="block text-xs text-amber-800">{source.unallocatedLines} itens com rateio pendente por falta de CMV em um componente.</span>}{!!source.ignoredComponents?.length && <span className="block text-xs text-stone-500">Componentes auxiliares fora da análise: {source.ignoredComponents.join(", ")}</span>}</li>)}</ul>
              </section>}
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["Por empresa", drill.companies],
                  ["Por integração / canal", drill.channels],
                ].map(([title, values]) => (
                  <div className="card p-4" key={String(title)}>
                    <h3 className="font-semibold mb-3">{String(title)}</h3>
                    {(values as Drill["companies"]).map((v, i) => (
                      <div
                        key={i}
                        className="flex justify-between gap-3 text-sm py-2 border-t border-[var(--color-border-light)]"
                      >
                        <span>{v.name}</span>
                        <span className="whitespace-nowrap">
                          {money(v.revenue)}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="text-sm w-full">
                  <thead>
                    <tr>
                      {[
                        "Pedido",
                        "Data",
                        "Empresa / conexão",
                        "Origem",
                        "Situação",
                        "Valor",
                      ].map((v) => (
                        <th className="text-left p-2" key={v}>
                          {v}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {drill.orders.map((o) => (
                      <tr
                        key={`${o.connection}:${o.id}`}
                        className="border-t border-[var(--color-border-light)]"
                      >
                        <td className="p-2">{o.number || o.id}</td>
                        <td className="p-2 whitespace-nowrap">{o.date}</td>
                        <td className="p-2">
                          {o.company}
                          <span className="block text-xs">{o.connection}</span>
                        </td>
                        <td className="p-2">{o.source}</td>
                        <td className="p-2">{ORDER_STATUSES[o.status]}</td>
                        <td className="p-2 whitespace-nowrap">
                          {money(o.revenue)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3 items-center">
                <button
                  className="btn-ghost"
                  disabled={drillPage === 1}
                  onClick={() => setDrillPage((v) => v - 1)}
                >
                  Anterior
                </button>
                <p className="text-sm">
                  {drillPage} / {Math.max(1, Math.ceil(drill.total / 50))} ·{" "}
                  {drill.total} pedidos
                </p>
                <button
                  className="btn-ghost"
                  disabled={drillPage * 50 >= drill.total}
                  onClick={() => setDrillPage((v) => v + 1)}
                >
                  Próxima
                </button>
              </div>
            </>
          )}
        </div>
      </dialog>
    </div>
  );
}
