"use client";
import { DatePicker } from "@/components/ui/date-picker";
import { ANALYTICS_REQUEST_TIMEOUT_MS } from "@/lib/request-timeouts";
import { Select } from "@/components/ui/select";
import { Header } from "@/components/layout/header";


import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  LoaderCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  ABC_DEFAULTS,
  DIMENSIONS,
  ORDER_STATUSES,
} from "@/lib/analytics/config";
import { type CoverageJob } from "@/lib/analytics/coverage";
import { reportReliability } from "@/lib/analytics/reliability";
import { ABCExportActions, ABCModeTabs } from "./abc-controls";
import { ABCOverview, type ABCOverviewResult } from "./abc-overview";
import { LoadingRegion, ChartSkeleton, RowsSkeleton, TableSkeleton, Skeleton } from "@/components/ui/loading-region";
import { kpiSnapshot } from "@/lib/analytics/comparison";
import { useABCComparison } from "./use-abc-comparison";
import { ParetoChart } from "./pareto-chart";
import { money, number, pct } from "@/lib/analytics/format";
import { paretoHighlighted, type ParetoHighlight } from "@/lib/analytics/pareto";
import { progressVersion } from "@/lib/analytics/progress";
import { revenueDescending, searchTableRows } from "@/lib/analytics/table-view";
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
    total?: string;
    items?: { name: string; sku: string; quantity: string; unitPrice: string; subtotal: string }[];
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
const columnWidths: Record<Column, number> = { rank: 96, sku: 160, name: 320, quantity: 120, revenue: 168, percent: 128, cumulative: 144, orders: 104, class: 88 };
const emptyClass = { count: 0, revenue: "0", quantity: "0", percent: 0 };
const EMPTY_RESULT: ABCResult = { rows: [], pareto: [], total: 0, revenue: "0", quantity: "0", orders: 0, top10: 0,
  classes: { A: emptyClass, B: emptyClass, C: emptyClass }, generatedAt: "" };
function EntityName({ name }: { name: string }) {
  return <>{name.split(/(sem v[ií]nculo d[eo] cat[aá]logo)/i).map((part, index) =>
    index % 2 ? <strong key={index} className="font-bold text-[var(--color-accent-red)]">{part}</strong> : part,
  )}</>;
}
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
class AnalyticsRequestError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}
async function jsonRequest(path: string, body?: unknown, signal?: AbortSignal) {
  const requestSignal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS)])
    : AbortSignal.timeout(ANALYTICS_REQUEST_TIMEOUT_MS);
  const response = await fetch(
    path,
    body === undefined
      ? { cache: "no-store", signal: requestSignal }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: requestSignal,
        },
  );
  const data = await response.json();
  if (!response.ok)
    throw new AnalyticsRequestError(data.error || "Não foi possível consultar os dados.", data.code);
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
  const [searchScope, setSearchScope] = useState({ dimension, search });
  if (searchScope.dimension !== dimension || searchScope.search !== search) {
    setSearchScope({ dimension, search });
    setRemote(null);
    setSearchError(false);
  }
  useEffect(() => {
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
    <details className="rounded-xl border border-[var(--color-border-light)] p-3 bg-[var(--color-bg-secondary)]">
      <summary className="cursor-pointer text-[15px] font-medium">
        {DIMENSIONS[dimension]}{" "}
        <span className="text-[var(--color-text-secondary)]">
          · {selected.length || "Todos"}
        </span>
      </summary>
      {options.length ? (
        <div className="mt-3 space-y-2">
          <input
            aria-label={`Buscar em ${DIMENSIONS[dimension]}`}
            className="field text-[15px]"
            placeholder="Buscar…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button
            type="button"
            className="text-[13px] text-[var(--color-abc-range-ink)] underline"
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
                <label key={o.value} className="flex items-start gap-2 text-[15px]">
                  <input
                    type="checkbox"
                    className="mt-1 accent-[var(--color-accent-blue)]"
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
            <p className="text-[13px]">
              Exibindo até 200 opções. Busque no servidor para encontrar outras.
            </p>
          )}
          {searchError && (
            <p role="status" className="text-[13px] text-[var(--color-abc-down)]">
              Busca temporariamente indisponível.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 text-[13px] text-[var(--color-text-secondary)]">
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
    costBasis: ABC_DEFAULTS.costBasis,
    selections: { statuses: ABC_DEFAULTS.statuses.map(String) },
  }));
  const [filters, setFilters] = useState(draft),
    [status, setStatus] = useState<Status | null>(null),
    [result, setResult] = useState<ABCResult | null>(null);
  const [overviewResult, setOverviewResult] = useState<ABCOverviewResult | null>(null);
  const [foregroundLoading, setForegroundLoading] = useState(true);
  const [tableRefresh, setTableRefresh] = useState(false);
  const reportScope = useRef("");
  const [reportFailed, setReportFailed] = useState(false);
  const backgroundRefresh = useRef(false);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [highlight, setHighlight] = useState<ParetoHighlight | null>(null);
  const highlightRow = result?.pareto.find(row => row.entityId === highlight?.entityId) || result?.rows.find(row => row.entityId === highlight?.entityId) || null;
  const updateHighlight = (next: ParetoHighlight | null) => setHighlight(current =>
    current?.entityId === next?.entityId && current?.cumulative === next?.cumulative && current?.origin === next?.origin && current?.targetPercentage === next?.targetPercentage ? current : next);
  const [error, setError] = useState<string | AnalyticsRequestError | null>(null),
    [schedulingError, setSchedulingError] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [filtersExpanded, setFiltersExpanded] = useState(false),
    [page, setPage] = useState(1),
    [size, setSize] = useState(25),
    [sort, setSort] = useState("rank"),
    [direction, setDirection] = useState("asc"),
    [refresh, setRefresh] = useState(0),
    [dataRefresh, setDataRefresh] = useState(0);
  const [schedulingScope, setSchedulingScope] = useState({ filters, refresh });
  if (schedulingScope.filters !== filters || schedulingScope.refresh !== refresh) {
    setSchedulingScope({ filters, refresh });
    setSchedulingError(null);
  }
  const [search, setSearch] = useState("");
  const [searchPage, setSearchPage] = useState(1);
  const [exportNotice, setExportNotice] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const searchQuery = useDeferredValue(search);
  const completeRanking = !!result && result.pareto.length === result.total;
  const searching = !!searchQuery.trim() && completeRanking;
  const matches = useMemo(() => searching && result
    ? searchTableRows(result.pareto, searchQuery, sort, direction, filters.grouping === "customer") : [],
  [searching, result, searchQuery, sort, direction, filters.grouping]);
  const tableTotal = searching ? matches.length : result?.total || 0;
  const tablePages = Math.max(1, Math.ceil(tableTotal / size));
  const tablePage = searching ? Math.min(searchPage, tablePages) : page;
  const tableRows = searching ? matches.slice((tablePage - 1) * size, tablePage * size) : result?.rows || [];
  const filtersChanged = JSON.stringify(draft) !== JSON.stringify(filters);
  const appliedSelections = (Object.keys(DIMENSIONS) as Dimension[]).filter(dim => filters.selections[dim]?.length);
  const activeFilterCount = appliedSelections.reduce((count, dim) => count + (filters.selections[dim]?.length || 0), 0);
  const markForeground = () => {
    backgroundRefresh.current = false;
    setBackgroundRefreshing(false);
    setForegroundLoading(true);
    setTableRefresh(false);
    setLoading(true);
  };
  const markTableRefresh = () => {
    backgroundRefresh.current = false;
    setBackgroundRefreshing(false);
    setForegroundLoading(false);
    setTableRefresh(true);
    setLoading(true);
  };
  const switchGrouping = (grouping: ABCFilters["grouping"]) => {
    markForeground();
    setDraft(f => ({ ...f, grouping }));
    setFilters(f => ({ ...f, grouping }));
    setSearch("");
    setSearchPage(1);
    setHighlight(null);
    setPage(1);
  };
  const [columns, setColumns] = useState<Column[]>(
      Object.keys(labels) as Column[],
    ),
    [entity, setEntity] = useState<ABCRow | null>(null),
    [drillResult, setDrillResult] = useState<{ scope: string; page: number; direction: "asc" | "desc"; data: Drill } | null>(null),
    [drillRequest, setDrillRequest] = useState({ page: 1, direction: "desc" as "asc" | "desc" }),
    [drillLoading, setDrillLoading] = useState(false),
    [drillError, setDrillError] = useState<string | null>(null);
  const [drillInputs, setDrillInputs] = useState({ entity, drillRequest, filters });
  if (drillInputs.entity !== entity || drillInputs.drillRequest !== drillRequest || drillInputs.filters !== filters) {
    setDrillInputs({ entity, drillRequest, filters });
    if (entity) {
      setDrillLoading(true);
      setDrillError(null);
    }
  }
  const drillScope = entity ? JSON.stringify({ filters, entity: entity.entityId }) : "";
  const visibleColumns = columns.filter(column => filters.grouping !== "customer" || column !== "sku");
  const columnLabel = (column: Column) => column === "name" ? (filters.grouping === "customer" ? "Cliente" : "Produto")
    : column === "revenue" && result?.composition ? "Valor atribuído" : labels[column];
  const currentDrill = drillResult?.scope === drillScope ? drillResult : null;
  const drill = currentDrill?.data;
  const drillPage = currentDrill?.page || 1;
  const drillTotalPages = Math.max(1, Math.ceil((drill?.total || 0) / 50));
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const scheduledFilters = useRef("");
  const statusSequence = useRef(0);
  const lastProgress = useRef("");
  const optionsLoadedAt = useRef(0);
  const reportSequence = useRef(0);
  const reportRunning = useRef(false);
  const foregroundPending = useRef(false);
  const pendingProgressRefresh = useRef<"all" | "data" | null>(null);
  const refreshFromProgress = useCallback((includeOptions: boolean) => {
    if (reportRunning.current || foregroundPending.current) {
      if (includeOptions || pendingProgressRefresh.current !== "all")
        pendingProgressRefresh.current = includeOptions ? "all" : "data";
      return;
    }
    backgroundRefresh.current = true;
    setBackgroundRefreshing(true);
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
    // Sorting and pagination only refresh rows. Keeping their controls visible
    // lets selects restore focus without scrolling back to the analysis above.
    const scope = JSON.stringify({ filters, refresh, dataRefresh });
    const tableOnly = reportScope.current === scope && !backgroundRefresh.current;
    reportScope.current = scope;
    setForegroundLoading(!tableOnly && !backgroundRefresh.current);
    setTableRefresh(tableOnly);
    backgroundRefresh.current = false;
    setBackgroundRefreshing(false);
    setReportFailed(false);
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
          setOverviewResult({ ...kpiSnapshot(data), classes: data.classes, composition: data.composition });
          if (data.sync?.error) setError(data.sync.error);
        }
      })
      .catch((e) => {
        if (!abort.signal.aborted && e.name !== "AbortError") {
          setError(e instanceof AnalyticsRequestError ? e : e.message);
          setReportFailed(true);
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
    jsonRequest(
      "/api/analytics/drilldown",
      { filters, entity: entity.entityId, page: drillRequest.page, ...(filters.grouping === "customer" ? { direction: drillRequest.direction } : {}) },
      abort.signal,
    )
      .then((data) => {
        if (!abort.signal.aborted) setDrillResult({ scope: drillScope, page: drillRequest.page, direction: drillRequest.direction, data });
      })
      .catch((e) => {
        if (!abort.signal.aborted && e.name !== "AbortError") setDrillError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setDrillLoading(false);
      });
    return () => abort.abort();
  }, [entity, drillRequest, filters, drillScope]);
  const reliability = status ? reportReliability(status, filters) : null;
  const comparison = useABCComparison(filters, refresh, dataRefresh);
  const showSkeletons = foregroundLoading && !backgroundRefreshing && (loading || comparison.loading);
  const tableLoading = tableRefresh && loading;
  useLayoutEffect(() => { foregroundPending.current = showSkeletons; }, [showSkeletons]);
  const displayResult = result || EMPTY_RESULT;
  const reportUnavailable = reportFailed ? "Não foi possível carregar esta análise. Tente atualizar os dados." : null;
  useEffect(() => {
    if (loading || showSkeletons || !pendingProgressRefresh.current) return;
    const pending = pendingProgressRefresh.current;
    pendingProgressRefresh.current = null;
    refreshFromProgress(pending === "all");
  }, [loading, showSkeletons, refreshFromProgress]);
  const select = (dimension: Dimension, values: string[]) =>
    setDraft((f) => ({
      ...f,
      selections: { ...f.selections, [dimension]: values },
    }));
  const download = useCallback(
    async (format: "csv" | "xlsx") => {
      setExporting(true);
      setExportNotice("");
      setExportError(null);
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
        setExportNotice(`${format === "csv" ? "CSV" : "Excel"} pronto. Download iniciado.`);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (e) {
        setExportError(e instanceof Error ? e.message : "Falha ao exportar.");
      } finally {
        setExporting(false);
      }
    },
    [filters],
  );
  const openEntity = (row: ABCRow) => {
    setEntity(row);
    setDrillRequest({ page: 1, direction: "desc" });
    setDrillError(null);
    dialog?.showModal();
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
        className={`px-2.5 py-1 rounded-full font-semibold ${row.class === "A" ? "bg-[var(--color-abc-a-soft)] text-[var(--color-abc-a-ink)]" : row.class === "B" ? "bg-[var(--color-abc-b-soft)] text-[var(--color-abc-b-ink)]" : "bg-[var(--color-abc-c-soft)] text-[var(--color-abc-c-ink)]"}`}
      ><span className="sr-only">Classe </span>{row.class}
      </span>
    ) : column === "name" ? (
      <button
        className="font-medium text-left hover:underline underline-offset-4"
        onClick={event => { event.stopPropagation(); openEntity(row); }}
      >
        <EntityName name={row.name} />
      </button>
    ) : (
      row[column]
    );
  return (
    <div className="w-full min-w-0 space-y-6 pb-6 [&_.field]:!text-[15px] [&_.app-control-label]:!text-[15px] [&_.app-date-input]:!text-[15px] [&_.btn-ghost]:!text-[15px] [&_.btn-primary]:!text-[15px] [&_th]:!text-[13px] [&_.page-description]:!text-[15px] [&_.analysis-toolbar_nav]:text-[13px]">
      <div className="analysis-toolbar flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
        <Header title="Curva ABC" breadcrumbs={["Abelha Par", "Néctar"]} description="Entenda o que concentra suas vendas." />
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
          <div className="w-full text-[13px] text-[var(--color-text-secondary)] sm:mr-2 sm:w-auto">
            {result ? <>Atualizado <time dateTime={result.generatedAt}>{new Date(result.generatedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></> : "Aguardando dados"}
          </div>
          <button className="btn-ghost" onClick={() => { markForeground(); setRefresh(v => v + 1); }} disabled={loading || showSkeletons}>
            <RefreshCw aria-hidden="true" className={`w-[17px] h-[17px] ${loading ? "motion-safe:animate-spin" : ""}`} />Atualizar
          </button>
          <ABCExportActions busy={exporting} disabled={!result?.total || loading || showSkeletons || reportFailed} onDownload={download} />
        </div>
      </div>
      {exportNotice && <p role="status" className="text-[15px] text-[var(--color-abc-up)]">{exportNotice}</p>}
      {exportError && <p role="alert" className="card p-4 text-[15px] text-[var(--color-abc-down)]">{exportError}</p>}
      <ABCModeTabs grouping={filters.grouping} onChange={switchGrouping} />
          {(loading || showSkeletons) && (
            <div role="status" className="pointer-events-none fixed bottom-4 right-4 z-40 rounded-full border border-[var(--color-border-light)] bg-[var(--color-bg-primary)] p-3 text-[var(--color-accent-blue)] shadow-sm">
              <LoaderCircle aria-hidden="true" className="h-[22px] w-[22px] motion-safe:animate-spin" />
              <span className="sr-only">Atualizando a Curva ABC…</span>
            </div>
          )}
      <div id="abc-analysis-panel" role="tabpanel" aria-labelledby={`abc-tab-${filters.grouping === "parent" ? "product" : filters.grouping}`} className="min-w-0 space-y-6">
      <form
        className="card p-5 sm:p-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setSearchPage(1);
          markForeground();
          setFilters({ ...draft });
          setRefresh(value => value + 1);
        }}
      >
        <div className="flex flex-wrap items-end gap-4">
        <div className="grid w-full gap-4 sm:w-auto sm:min-w-[360px] sm:flex-1 sm:grid-cols-2 lg:max-w-xl">
          <div className="text-[15px] font-medium">
            <DatePicker
              label="De"
              required
              className="field mt-2"
              value={draft.from}
              max={draft.to}
              onValueChange={(e) =>
                setDraft((f) => ({ ...f, from: e }))}
            />
          </div>
          <div className="text-[15px] font-medium">
            <DatePicker
              label="Até"
              required
              className="field mt-2"
              value={draft.to}
              min={draft.from}
              onValueChange={(e) => setDraft((f) => ({ ...f, to: e }))}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {[7, 30, 90].map(n => <button
            type="button"
            key={n}
            className="btn-ghost text-[13px]"
            onClick={() => setDraft(f => ({ ...f, from: dayBefore(today(), n - 1), to: today() }))}
          >Últimos {n} dias</button>)}
          <button className="btn-primary" type="submit" disabled={loading || showSkeletons}>Analisar vendas</button>
          <button
            type="button"
            className="btn-ghost sm:ml-auto"
            aria-expanded={filtersExpanded}
            aria-controls="abc-extra-filters"
            onClick={() => { setFiltersExpanded(value => !value); setAdvanced(false); }}
          >
            <Filter className="w-[17px] h-[17px]" />
            {filtersExpanded ? "Recolher filtros" : "Mais filtros"}
          </button>
        </div>
        </div>
        <div className="flex h-28 flex-wrap items-center gap-2 overflow-y-auto border-t border-[var(--color-border-light)] pt-3 text-[13px] text-[var(--color-text-secondary)] sm:h-24 xl:h-16" aria-label="Filtros aplicados">
          <span>{filters.from.split("-").reverse().join("/")} — {filters.to.split("-").reverse().join("/")}</span>
          <span className="rounded-full bg-[var(--color-bg-tertiary)] px-2 py-1">{activeFilterCount} seleções aplicadas</span>
          <span>{filters.metric === "quantity" ? "Quantidade" : "Valor bruto"} · {filters.basis === "orders" ? "Data da venda" : "Emissão da NF"}</span>
          {appliedSelections.filter(dim => dim !== "statuses").map(dim => <span key={dim} className="rounded-full border border-[var(--color-border-light)] px-2 py-1">{DIMENSIONS[dim]}: {filters.selections[dim]!.length}</span>)}
          {filtersChanged && <span role="status" className="text-[var(--color-abc-range-ink)]">Alterações não aplicadas</span>}
          <button type="button" className="btn-ghost text-[13px] sm:ml-auto" onClick={() => {
            markForeground();
            const cleared = { ...filters, selections: { statuses: ABC_DEFAULTS.statuses.map(String) } };
            setDraft(current => ({ ...current, selections: cleared.selections })); setFilters(cleared); setPage(1); setSearchPage(1);
          }}>Limpar seleções</button>
        </div>
        {filtersExpanded && <div id="abc-extra-filters" className="space-y-4 border-t border-[var(--color-border-light)] pt-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="text-[15px] font-medium">
            <Select
              label="Métrica"
              className="field mt-2"
              value={draft.metric}
              onValueChange={(e) =>
                setDraft((f) => ({
                  ...f,
                  metric: e as ABCFilters["metric"],
                }))}
            >
              <option value="revenue">Valor bruto dos itens</option>
              <option value="quantity">Quantidade vendida</option>
            </Select>
          </div>
          <div className="text-[15px] font-medium">
            <Select
              label="Base"
              className="field mt-2"
              value={draft.basis}
              onValueChange={(e) =>
                setDraft((f) => ({
                  ...f,
                  basis: e as ABCFilters["basis"],
                }))}
            >
              <option value="orders">Pedidos · data da venda</option>
              <option value="invoiced">
                Pedidos com NF autorizada · emissão
              </option>
            </Select>
          </div>
          {draft.grouping === "composition" && <div className="text-[15px] font-medium"><Select label="Base do CMV histórico" className="field mt-2" value={draft.costBasis || ABC_DEFAULTS.costBasis} onValueChange={e => setDraft(f => ({ ...f, costBasis: e as ABCFilters["costBasis"] }))}>
              <option value="purchase">Custo de compra por vigência</option>
              <option value="average">Custo médio por vigência</option>
            </Select>
            <span className="mt-1 block text-[13px] text-[var(--color-text-secondary)]">A base selecionada usa o histórico na data da venda. Valores zerados ou negativos informados são aceitos, sem trocar a base de custo.</span>
          </div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-ghost text-[13px]"
            onClick={() => setDraft(f => ({ ...f, from: dayBefore(today(), 364), to: today() }))}
          >Últimos 365 dias</button>
          <button
            type="button"
            className="btn-ghost text-[13px]"
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
            className="btn-ghost text-[13px]"
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
          <Filter className="w-[17px] h-[17px]" />
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
              <div className="text-[15px]">
                <Select
                  label="Regra ABC"
                  className="field mt-2"
                  value={draft.mode}
                  onValueChange={(e) =>
                    setDraft((f) => ({
                      ...f,
                      mode: e as ABCFilters["mode"],
                    }))}
                >
                  <option value="TINY_LEGACY">
                    Tiny histórico · acumulado anterior
                  </option>
                  <option value="STRICT_CUMULATIVE">
                    Estrito · acumulado após a linha
                  </option>
                </Select>
              </div>
              <label className="text-[15px]">
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
              <label className="text-[15px]">
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
                <div className="text-[15px]">
                  <Select
                    label="Agrupar produtos"
                    className="field mt-2"
                    value={draft.grouping}
                    onValueChange={(e) =>
                      setDraft((f) => ({
                        ...f,
                        grouping: e as ABCFilters["grouping"],
                      }))}
                  >
                    <option value="product">
                      Registro da empresa / variação
                    </option>
                    <option value="parent">Produto pai documentado</option>
                    <option value="composition">Produto base · composição confirmada</option>
                  </Select>
                </div>
              )}
            </div>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              Sem produto pai na API, o registro permanece individual. Receita
              líquida após devoluções, CMV e margem exigem dados adicionais e
              não são calculados nesta versão.
            </p>
            <p className="text-[13px] text-[var(--color-text-secondary)]">
              No modo Tiny histórico, a classe usa o acumulado anterior. No estrito,
              usa o acumulado após a linha: um único produto com 100% fica na classe C.
              Igualdade com 80% ou 95% avança para a classe seguinte.
            </p>
          </div>
        )}
        <div className="flex flex-wrap gap-3">
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
        </div>}
      </form>
      {(error || schedulingError) && (
        <div className="card fixed bottom-24 left-4 right-4 z-50 mx-auto max-w-2xl p-5 text-[var(--color-abc-down)] shadow-lg lg:bottom-6" role="alert">
          {(typeof error === "string" ? error : error?.message) || schedulingError}
          {isAdmin && !(error instanceof AnalyticsRequestError && ["HISTORICAL_COST_UNAVAILABLE", "ANALYTICS_MIGRATION_REQUIRED"].includes(error.code || "")) && (
            <p className="mt-2">
              <Link href="/ninho" className="underline">
                Verificar conexões no Ninho
              </Link>
            </p>
          )}
        </div>
      )}
      <ABCOverview result={overviewResult || EMPTY_RESULT} filters={filters} comparison={comparison} loading={loading || !result || reportFailed} skeleton={showSkeletons} error={reportUnavailable} />
          {isAdmin && displayResult.composition && <LoadingRegion as="section" loading={showSkeletons} error={reportUnavailable} skeleton={<Skeleton className="m-5 h-[22px] w-[22px]6" />} className="card p-5 space-y-3 border-[var(--color-border-light)] bg-[var(--color-abc-up-soft)]" label="Regras da consolidação"><details>
            <summary className="cursor-pointer font-medium text-[var(--color-abc-up)]">Regras da consolidação
            <h2 className="font-semibold">Produtos base · composições confirmadas</h2>
            </summary>
            <p className="text-[15px] text-[var(--color-text-secondary)]">{displayResult.composition.mappedEntities} produtos base consolidados. Cada combo contribui para os seus componentes nas respectivas unidades de estoque. {displayResult.composition.costSource?.allocationPolicy !== "signed_cost_magnitude_zero_quantity" && "O valor vendido é dividido proporcionalmente ao CMV de referência × quantidade de cada componente, com ajuste dos centavos residuais."}</p>
            <p className="text-[13px] text-[var(--color-text-secondary)]">CMV de referência: {displayResult.composition.costSource?.name || "Olist 1"}, atualizado automaticamente. {displayResult.composition.costSource?.basis === "purchase" ? "Custo de compra" : "Custo médio"} vigente no dia de cada {filters.basis === "invoiced" ? "emissão da NF" : "venda"}; fechamento diário em São Paulo. Custos posteriores não são aplicados às vendas anteriores. {displayResult.composition.costSource?.lastSyncedAt ? `Históricos sincronizados até: ${new Date(displayResult.composition.costSource.lastSyncedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}.` : "Primeira sincronização dos históricos em andamento."}</p>
            {displayResult.composition.periodCostCents != null && <p className="text-[15px] text-[var(--color-text-secondary)]">Custo de referência das unidades vendidas: <strong>{money(displayResult.composition.periodCostCents)}</strong>. Soma das quantidades × custo histórico aplicável de cada componente.</p>}
            {displayResult.composition.costSource?.allocationPolicy === "signed_cost_magnitude_zero_quantity" && <p className="text-[13px] text-[var(--color-text-secondary)]">O CMV preserva valores zerados e negativos. O rateio da receita usa a magnitude dos custos; quando todos os custos do kit são zero, usa a quantidade de cada componente. Centavos residuais são distribuídos sem alterar o valor original da venda.</p>}
            {!!displayResult.composition.zeroCostLines && <p className="text-[13px] text-[var(--color-text-secondary)]">{displayResult.composition.zeroCostLines} itens vendidos incluem componente com custo informado zero.</p>}
            {!!displayResult.composition.negativeCostLines && <p className="text-[13px] text-[var(--color-text-secondary)]">{displayResult.composition.negativeCostLines} itens vendidos incluem componente com custo negativo, preservado no CMV.</p>}
            {!!displayResult.composition.quantityAllocationLines && <p className="text-[13px] text-[var(--color-text-secondary)]">{displayResult.composition.quantityAllocationLines} kits com todos os custos zerados foram rateados pela quantidade dos componentes.</p>}
            {!!displayResult.composition.costMissingLines && <p className="text-[13px] text-[var(--color-abc-range-ink)]">Custo de referência total incompleto: {displayResult.composition.costMissingLines} itens sem custo histórico válido. Parcela conhecida: {money(displayResult.composition.knownCostCents || "0")}. Valores ausentes não são considerados custo zero.</p>}
            {displayResult.composition.costSource?.lastError && <p role="alert" className="rounded-xl border border-[var(--color-abc-range-border)] bg-[var(--color-abc-range-end)] p-3 text-[15px] text-[var(--color-abc-range-ink)]">A atualização do CMV está pendente: {displayResult.composition.costSource.lastError} O relatório usa a última referência disponível.</p>}
            {!!displayResult.composition.unallocatedLines && <p role="alert" className="rounded-xl border border-[var(--color-abc-range-border)] bg-[var(--color-abc-range-end)] p-3 text-[15px] text-[var(--color-abc-range-ink)]">Rateio incompleto: {money(displayResult.composition.unallocatedRevenue)} de {displayResult.composition.unallocatedLines} itens vendidos aguardam CMV de {displayResult.composition.missingCostSkus.join(", ")}. As quantidades dos componentes estão incluídas; os valores desses combos ainda não foram atribuídos aos produtos. Valor original dos itens: {money(displayResult.composition.originalRevenue)}.</p>}
            <p className="text-[13px] text-[var(--color-text-secondary)]">Filtros de SKU, produto e produto pai selecionam os registros originais da venda antes da consolidação. Regra {displayResult.composition.version}.</p>
            {!!displayResult.composition.ignoredComponentSkus?.length && <p className="text-[13px] text-[var(--color-text-secondary)]">A Embalagem BelezaFIX é desconsiderada como componente nesta análise. Os SKUs de origem continuam no detalhamento para permitir a separação entre versões com e sem embalagem.</p>}
            {!!displayResult.composition.pendingTotal && <details>
              <summary className="cursor-pointer text-[15px] font-medium text-[var(--color-abc-range-ink)]">{displayResult.composition.pendingTotal} SKUs sem vínculo confirmado permanecem separados · revisar composição</summary>
              <ul className="mt-3 space-y-2 text-[15px] text-[var(--color-text-secondary)]">{displayResult.composition.pending.map(item => <li key={item.sku}><span className="font-mono text-[13px] font-semibold">{item.sku}</span> · <EntityName name={item.name} /><span className="block text-[13px] text-[var(--color-abc-range-ink)]">{item.reason} · {item.orders} pedidos</span></li>)}</ul>
              {displayResult.composition.pendingTotal > displayResult.composition.pending.length && <p className="mt-2 text-[13px]">Primeiros {displayResult.composition.pending.length} SKUs pendentes; a exportação mantém todos os registros no ranking.</p>}
            </details>}
            </details>
          </LoadingRegion>}
          <LoadingRegion loading={showSkeletons} error={reportUnavailable} label="Gráfico de concentração das vendas" skeleton={<ChartSkeleton />}>
          <ParetoChart
            result={displayResult}
            a={filters.thresholdA}
            b={filters.thresholdB}
            highlight={highlightRow ? highlight : null}
            onHighlight={updateHighlight}
            onOpen={openEntity}
            entityLabel={filters.grouping === "customer" ? "cliente" : "produto"}
          />
          </LoadingRegion>
          <LoadingRegion as="section" className="card min-w-0 [overflow-anchor:none]" label="Ranking ABC" loading={showSkeletons} error={reportUnavailable} skeleton={<TableSkeleton columns={visibleColumns.length} rows={14} />}>
            <div className="p-5 space-y-3">
              <div className="flex flex-wrap justify-between items-center gap-3">
                <h2 className="font-semibold">
                  {filters.grouping === "customer" ? "Clientes" : "Produtos"} ·{" "}
                  {number(displayResult.total)} entidades
                </h2>
                <div className="relative w-full sm:w-80">
                  <label htmlFor="abc-table-search" className="sr-only">{filters.grouping === "customer" ? "Buscar clientes" : "Buscar produtos ou SKU"}</label>
                  <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-[17px] w-[17px] text-[var(--color-text-tertiary)]" />
                  <input id="abc-table-search" type="search" value={search} disabled={!completeRanking} aria-describedby="abc-search-scope" className="field !pl-10 !pr-10" placeholder={filters.grouping === "customer" ? "Buscar clientes…" : "Buscar produto ou SKU…"} onChange={event => { setSearch(event.target.value); setSearchPage(1); }} />
                  {search && <button aria-label="Limpar busca" className="absolute right-2 top-2 rounded-lg p-1.5 hover:bg-[var(--color-abc-range-end)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent-blue)]" onClick={() => { setSearch(""); setSearchPage(1); }}><X aria-hidden="true" className="h-[17px] w-[17px]" /></button>}
                </div>
              </div>
              <p id="abc-search-scope" className="text-[13px] text-[var(--color-text-secondary)]">{!completeRanking ? "Busca indisponível: o servidor retornou um ranking incompleto." : searching ? `${number(tableTotal)} de ${number(displayResult.total)} registros · posição e classe originais preservadas.` : "Busca em todo o ranking. Exportações incluem todos os registros dos filtros aplicados."}</p>
              <details>
                <summary className="text-[15px] cursor-pointer">
                  Colunas da tabela
                </summary>
                <div className="flex flex-wrap gap-4 mt-3">
                  {(Object.keys(labels) as Column[]).filter(c => filters.grouping !== "customer" || c !== "sku").map((c) => (
                    <label key={c} className="text-[13px] flex gap-2">
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
                      {columnLabel(c)}
                    </label>
                  ))}
                </div>
              </details>
            </div>
            <div className="h-[min(720px,70dvh)] min-h-80 overflow-auto overscroll-x-contain [scrollbar-gutter:stable] [overflow-anchor:none]" tabIndex={0} role="region" aria-label="Tabela do ranking ABC" aria-busy={tableLoading}>
              <table className="w-full min-w-[960px] table-fixed text-[15px] text-left">
                <colgroup>{visibleColumns.map(column => <col key={column} style={{ width: columnWidths[column] }} />)}</colgroup>
                <caption className="sr-only">Ranking completo do período, com paginação. Valores e classes calculados pelo servidor.</caption>
                <thead className="sticky top-0 z-10 bg-[var(--color-bg-tertiary)]">
                  <tr>
                    {visibleColumns.map((c) => (
                      <th
                        key={c}
                        scope="col"
                        className={`px-4 py-3 whitespace-nowrap ${["name", "sku", "class"].includes(c) ? "text-left" : "text-right"}`}
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
                          aria-disabled={loading || undefined}
                          className="rounded focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--color-accent-blue)]"
                          onClick={() => {
                            if (loading) return;
                            markTableRefresh();
                            setSort(c);
                            setDirection(
                              sort === c && direction === "asc"
                                ? "desc"
                                : "asc",
                            );
                            setPage(1);
                            setSearchPage(1);
                          }}
                        >
                          {columnLabel(c)}
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
                <tbody aria-hidden={tableLoading || undefined}>
                  {tableRows.map((row) => (
                    <tr
                      key={row.entityId}
                      inert={tableLoading || undefined}
                      data-abc-entity={row.entityId}
                      data-highlighted={paretoHighlighted(row, highlightRow, !!highlight?.cumulative)}
                      className={`cursor-pointer border-t border-[var(--color-border-light)] transition-colors duration-75 motion-reduce:transition-none ${paretoHighlighted(row, highlightRow, !!highlight?.cumulative) ? "bg-[linear-gradient(135deg,var(--color-abc-range-start),var(--color-abc-range-end))] ring-1 ring-inset ring-[var(--color-abc-range-border)]" : "hover:bg-[var(--color-abc-range-end)]"}`}
                      tabIndex={0}
                      aria-label={`Ver pedidos de ${row.name}`}
                      onClick={() => openEntity(row)}
                      onKeyDown={event => {
                        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                          event.preventDefault(); openEntity(row);
                        }
                      }}
                      onPointerEnter={() => updateHighlight({ entityId: row.entityId, cumulative: false, origin: "table" })}
                      onPointerLeave={() => { if (highlight?.origin === "table") updateHighlight(null); }}
                      onFocus={() => updateHighlight({ entityId: row.entityId, cumulative: false, origin: "table" })}
                      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && highlight?.origin === "table") updateHighlight(null); }}
                    >
                      {visibleColumns.map((c) => (
                        <td
                          key={c}
                          title={c === "revenue" ? money(row.revenue) : c === "quantity" ? number(row.quantity) : c === "sku" ? row.sku || undefined : undefined}
                          className={`relative px-4 py-4 ${c === "name" ? "min-w-64 max-w-md break-words" : ["sku", "class"].includes(c) ? "overflow-hidden text-ellipsis whitespace-nowrap" : "overflow-hidden text-ellipsis whitespace-nowrap tabular-nums text-right"}`}
                        >
                          <span style={tableLoading ? { visibility: "hidden" } : undefined}>{cell(row, c)}</span>
                          {tableLoading && <Skeleton className="absolute left-4 right-4 top-1/2 h-3 -translate-y-1/2" />}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {searching && !tableTotal && <div className="p-10 text-center" role="status"><h3 className="font-semibold">Nenhum resultado para esta busca</h3><p className="mt-2 text-[15px] text-[var(--color-text-secondary)]">Tente outro nome{filters.grouping === "customer" ? "." : " ou SKU."}</p><button className="btn-ghost mt-3" onClick={() => setSearch("")}>Limpar busca</button></div>}
              {!displayResult.total && (
                <div className="p-10 text-center">
                  <h3 className="font-semibold">
                    {reliability?.emptyTitle || "Cobertura ainda não verificada"}
                  </h3>
                  <p className="text-[15px] mt-2 text-[var(--color-text-secondary)]">
                    Confira o período, as situações, as empresas e a cobertura
                    de importação.
                  </p>
                </div>
              )}
            </div>
            <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border-light)]">
              <div className="text-[13px] flex items-center gap-2"><Select label="Por página" inline
                  className="field w-auto"
                  value={size}
                  onValueChange={(e) => {
                    if (Number(e) === size) return;
                    markTableRefresh();
                    setSize(Number(e));
                    setPage(1);
                    setSearchPage(1);
                  }}
                >
                  {[25, 50, 100].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </Select>
              </div>
              <p className="text-[13px] text-[var(--color-text-secondary)]" aria-live="polite">{tableTotal ? number((tablePage - 1) * size + 1) : "0"}–{number(Math.min(tablePage * size, tableTotal))} de {number(tableTotal)} registros</p>
              <div className="flex items-center gap-3">
                <button
                  aria-label="Página anterior"
                  className="btn-ghost"
                  aria-disabled={loading || tablePage === 1}
                  onClick={() => { if (loading || tablePage === 1) return; if (searching) setSearchPage(tablePage - 1); else { markTableRefresh(); setPage(v => v - 1); } }}
                >
                  <ChevronLeft className="w-[17px] h-[17px]" />
                </button>
                <span className="text-[15px]">
                  {tablePage} / {tablePages}
                </span>
                <button
                  aria-label="Próxima página"
                  className="btn-ghost"
                  aria-disabled={loading || tablePage >= tablePages}
                  onClick={() => { if (loading || tablePage >= tablePages) return; if (searching) setSearchPage(tablePage + 1); else { markTableRefresh(); setPage(v => v + 1); } }}
                >
                  <ChevronRight className="w-[17px] h-[17px]" />
                </button>
              </div>
            </div>
          </LoadingRegion>
      </div>
      <dialog
        ref={setDialog}
        onClose={() => {
          setEntity(null);
          setDrillResult(null);
          setDrillError(null);
          setDrillLoading(false);
        }}
        aria-labelledby="abc-detail-title"
        className="fixed inset-y-0 right-0 m-0 ml-auto h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border-l border-[var(--color-border-light)] bg-[var(--color-bg-primary)] text-[var(--color-text-primary)] p-0 open:flex md:w-1/2 backdrop:bg-black/40"
      >
        <style>{`html:has(dialog[aria-labelledby="abc-detail-title"]:modal), body:has(dialog[aria-labelledby="abc-detail-title"]:modal) { overflow: hidden; overscroll-behavior: none; }`}</style>
        <header className="flex shrink-0 justify-between items-start gap-3 border-b border-[var(--color-border-light)] px-5 py-4 sm:px-7">
          <h2 id="abc-detail-title" className="min-w-0 break-words text-lg font-semibold">{entity && <EntityName name={entity.name} />}</h2>
          <button
            aria-label="Fechar detalhes"
            className="btn-ghost shrink-0"
            onClick={() => dialog?.close()}
          >
            <X className="w-[22px] h-[22px]" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto overscroll-contain px-5 pt-5 pb-2 sm:px-7 sm:pt-7">
          {drillError && (
            <p role="alert" className="mb-5 text-[var(--color-abc-down)]">
              {drillError}
            </p>
          )}
          <LoadingRegion label="Detalhamento dos pedidos" loading={drillLoading} preserveHeight={false} className="!overflow-visible [&>[data-loading-placeholder]]:!static [&>[data-loading-content][aria-hidden=true]]:hidden" contentClassName="space-y-5" skeleton={<RowsSkeleton rows={7} />}>
          {drill && (
            <>
              <div className="grid items-start gap-4 sm:grid-cols-2">
                {[
                  ["Por empresa", drill.companies],
                  ["Por integração / canal", drill.channels],
                ].map(([title, values]) => (
                  <div className="card min-w-0 p-4" key={String(title)}>
                    <h3 className="font-semibold mb-3">{String(title)}</h3>
                    <div className={filters.grouping !== "customer" && title === "Por integração / canal" ? "max-h-60 overflow-y-auto overscroll-contain" : undefined}>
                    {revenueDescending(values as Drill["companies"]).map((v, i) => (
                      <div
                        key={i}
                        className="flex justify-between gap-3 text-[15px] py-2 border-t border-[var(--color-border-light)]"
                      >
                        <span className="min-w-0 break-words">{v.name}</span>
                        <span className="whitespace-nowrap">
                          {money(v.revenue)}
                        </span>
                      </div>
                    ))}
                    </div>
                  </div>
                ))}
              </div>
              {filters.grouping === "customer" ? <section aria-label="Pedidos do cliente" aria-busy={drillLoading}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-semibold">Pedidos</h3>
                  <Select label="Ordenar pedidos" inline value={currentDrill?.direction || drillRequest.direction} disabled={drillLoading}
                    popoverContainer={dialog ?? undefined} onValueChange={value => setDrillRequest({ page: 1, direction: value as "asc" | "desc" })}>
                    <option value="desc">Mais recentes primeiro</option>
                    <option value="asc">Mais antigos primeiro</option>
                  </Select>
                </div>
                <div className="divide-y divide-[var(--color-border-light)]">
                  {drill.orders.map(order => <article key={`${order.connection}:${order.id}`} className="py-5 first:pt-0">
                    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h4 className="break-words font-semibold">Pedido {order.number || order.id}</h4>
                        <p className="mt-1 text-[13px] text-[var(--color-text-secondary)]"><time dateTime={order.date}>{order.date}</time> · {ORDER_STATUSES[order.status] || order.status}</p>
                        <p className="mt-1 break-words text-[13px] text-[var(--color-text-secondary)]">{order.company} · {order.connection} · {order.source}</p>
                      </div>
                      <p className="text-right text-[13px] text-[var(--color-text-secondary)]">Total do pedido<strong className="block text-[15px] text-[var(--color-text-primary)]">{money(order.total ?? order.revenue)}</strong></p>
                    </header>
                    {order.items?.length ? <ul className="space-y-3">
                      {order.items.map((item, index) => <li key={`${item.sku}:${index}`} className="rounded-xl bg-[var(--color-bg-secondary)] p-3">
                        <p className="break-words text-[14px] font-medium"><EntityName name={item.name} /></p>
                        <p className="mt-1 break-words text-[12px] text-[var(--color-text-secondary)]">SKU: {item.sku || "—"}</p>
                        <dl className="mt-2 grid grid-cols-3 gap-2 text-[13px] tabular-nums">
                          <div><dt className="text-[var(--color-text-secondary)]">Qtd.</dt><dd>{number(item.quantity)}</dd></div>
                          <div><dt className="text-[var(--color-text-secondary)]">Unitário</dt><dd className="break-words">{money(item.unitPrice)}</dd></div>
                          <div className="text-right"><dt className="text-[var(--color-text-secondary)]">Subtotal</dt><dd className="break-words font-medium">{money(item.subtotal)}</dd></div>
                        </dl>
                      </li>)}
                    </ul> : <p className="text-[13px] text-[var(--color-text-secondary)]">Produtos indisponíveis neste pedido.</p>}
                  </article>)}
                </div>
                {!drill.orders.length && <p className="text-[14px] text-[var(--color-text-secondary)]">Nenhum pedido encontrado.</p>}
              </section> : <div aria-busy={drillLoading}>
                <table className="text-[15px] w-full min-w-[560px]">
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
                          <span className="block text-[13px]">{o.connection}</span>
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
              </div>}
              <div className="flex flex-wrap gap-3 items-center">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={drillLoading || drillPage === 1}
                  onClick={() => setDrillRequest({ page: drillPage - 1, direction: currentDrill?.direction || drillRequest.direction })}
                >
                  Anterior
                </button>
                <Select label="Página" inline value={drillPage} disabled={drillLoading || drillTotalPages === 1} popoverContainer={dialog ?? undefined} onValueChange={value => setDrillRequest({ page: Number(value), direction: currentDrill?.direction || drillRequest.direction })}>
                  {Array.from({ length: drillTotalPages }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
                </Select>
                <p className="text-[15px]">
                  de {drillTotalPages} ·{" "}
                  {drill.total} pedidos
                </p>
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={drillLoading || drillPage >= drillTotalPages}
                  onClick={() => setDrillRequest({ page: drillPage + 1, direction: currentDrill?.direction || drillRequest.direction })}
                >
                  Próxima
                </button>
                {drillLoading && <span role="status" className="flex items-center gap-2 text-[13px] text-[var(--color-text-secondary)]"><RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />Carregando página {drillRequest.page}…</span>}
              </div>
            </>
          )}
          </LoadingRegion>
        </div>
      </dialog>
    </div>
  );
}
