"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarChart3,
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
import { coversPeriod, type CoverageJob } from "@/lib/analytics/coverage";
import type {
  ABCFilters,
  ABCResult,
  ABCRow,
  Dimension,
  Option,
} from "@/lib/analytics/types";

type Status = {
  coverage?: CoverageJob[];
  companies: { id: string; name: string; tax_id: string | null }[];
  connections: {
    id: string;
    company_id: string;
    name: string;
    enabled: boolean;
    verified_at: string | null;
    last_synced_at: string | null;
    last_error: string | null;
  }[];
  jobs: (CoverageJob & { processed: number; last_error: string | null })[];
  options: Partial<Record<Dimension, Option[]>>;
};
type Drill = {
  total: number;
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
export function money(cents: string) {
  const v = BigInt(cents),
    whole = v / BigInt(100),
    fraction = (v % BigInt(100)).toString().padStart(2, "0");
  return `R$ ${whole.toLocaleString("pt-BR")},${fraction}`;
}
const number = (value: string | number) => {
  if (typeof value === "number")
    return value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const [whole, fraction = ""] = value.split(".");
  const tail = fraction.replace(/0+$/, "");
  return `${BigInt(whole || "0").toLocaleString("pt-BR")}${tail ? "," + tail : ""}`;
};
const pct = (value: number) => `${number(value)}%`;
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
            if (e.name !== "AbortError") setSearchError(true);
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
              Exibindo at? 200 op??es. Busque no servidor para encontrar outras.
            </p>
          )}
          {searchError && (
            <p role="status" className="text-xs text-red-800">
              Busca temporariamente indispon?vel.
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
function Pareto({ result, a, b }: { result: ABCResult; a: number; b: number }) {
  if (!result.pareto.length) return null;
  const rows = result.pareto,
    count = rows.length,
    width = 860,
    left = 48,
    plot = 780;
  const y = (v: number) => 210 - v * 1.8,
    x = (index: number) => left + ((index + 0.5) * plot) / count;
  return (
    <section className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="w-5 h-5 text-amber-700" />
        <h2 className="font-semibold">Concentração das vendas</h2>
      </div>
      <p className="text-sm text-[var(--color-text-secondary)]">
        Ranking da métrica escolhida. Barras: participação individual. Linha:
        acumulado.{" "}
        {result.total > count
          ? `Exibindo os primeiros ${count} de ${result.total} registros; o acumulado usa o conjunto completo.`
          : ""}
      </p>
      <svg
        className="w-full min-h-48"
        viewBox={`0 0 ${width} 250`}
        role="img"
        aria-label={`Gráfico de Pareto: ${result.total} entidades; os dez primeiros concentram ${pct(result.top10)}`}
      >
        {[0, 50, 100, a, b]
          .filter((v, i, all) => all.indexOf(v) === i)
          .map((v) => (
            <g key={v}>
              <line
                x1={left}
                x2={left + plot}
                y1={y(v)}
                y2={y(v)}
                stroke={v === a || v === b ? "#a16207" : "#e8e0d2"}
                strokeDasharray={v === a || v === b ? "5 4" : undefined}
              />
              <text
                x={left - 8}
                y={y(v) + 4}
                textAnchor="end"
                fontSize="11"
                fill="#6f6252"
              >
                {v}%
              </text>
            </g>
          ))}
        {rows.map((row, index) => (
          <rect
            key={row.entityId}
            x={x(index) - (plot / count) * 0.32}
            y={y(row.percent)}
            width={Math.max(1, (plot / count) * 0.64)}
            height={Math.max(0, row.percent * 1.8)}
            fill={
              row.class === "A"
                ? "#d97706"
                : row.class === "B"
                  ? "#f5bb20"
                  : "#d6cec0"
            }
          >
            <title>
              {row.rank}. {row.name}: {pct(row.percent)}, acumulado{" "}
              {pct(row.cumulative)}, classe {row.class}
            </title>
          </rect>
        ))}
        <polyline
          points={rows
            .map((row, i) => `${x(i)},${y(row.cumulative)}`)
            .join(" ")}
          fill="none"
          stroke="#21864f"
          strokeWidth="3"
        />
        <text x={left} y="235" fontSize="12" fill="#6f6252">
          1º
        </text>
        <text
          x={left + plot}
          y="235"
          textAnchor="end"
          fontSize="12"
          fill="#6f6252"
        >
          {rows[count - 1].rank}º
        </text>
      </svg>
      <p className="text-xs text-[var(--color-text-secondary)]">
        Referências A: {a}% · B: {b}% · Linha verde: acumulado.
      </p>
    </section>
  );
}

export function ABCDashboard({ isAdmin }: { isAdmin: boolean }) {
  const [draft, setDraft] = useState<ABCFilters>(() => ({
    from: dayBefore(today(), 29),
    to: today(),
    metric: "revenue",
    mode: ABC_DEFAULTS.mode,
    grouping: "product",
    thresholdA: ABC_DEFAULTS.thresholdA,
    thresholdB: ABC_DEFAULTS.thresholdB,
    basis: "orders",
    selections: { statuses: ABC_DEFAULTS.statuses.map(String) },
  }));
  const [filters, setFilters] = useState(draft),
    [status, setStatus] = useState<Status | null>(null),
    [result, setResult] = useState<ABCResult | null>(null);
  const [error, setError] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [exporting, setExporting] = useState(false),
    [advanced, setAdvanced] = useState(false),
    [page, setPage] = useState(1),
    [size, setSize] = useState(50),
    [sort, setSort] = useState("rank"),
    [direction, setDirection] = useState("asc"),
    [refresh, setRefresh] = useState(0);
  const [columns, setColumns] = useState<Column[]>(
      Object.keys(labels) as Column[],
    ),
    [entity, setEntity] = useState<ABCRow | null>(null),
    [drill, setDrill] = useState<Drill | null>(null),
    [drillPage, setDrillPage] = useState(1),
    [drillError, setDrillError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const abort = new AbortController();
    jsonRequest("/api/analytics/options", undefined, abort.signal)
      .then((data) => {
        if (!abort.signal.aborted) setStatus(data);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, [refresh]);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    jsonRequest(
      "/api/analytics/abc",
      { filters, page, size, sort, direction },
      abort.signal,
    )
      .then((data) => {
        if (!abort.signal.aborted) setResult(data);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError(e.message);
          setResult(null);
        }
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [filters, page, size, sort, direction, refresh]);
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
        if (e.name !== "AbortError") setDrillError(e.message);
      });
    return () => abort.abort();
  }, [entity, drillPage, filters]);
  const selectedConnections =
    status?.connections.filter(
      (c) =>
        (!filters.selections.companies?.length ||
          filters.selections.companies.includes(c.company_id)) &&
        (!filters.selections.connections?.length ||
          filters.selections.connections.includes(c.id)),
    ) || [];
  const companies =
    status?.companies.filter(
      (c) =>
        !filters.selections.companies?.length ||
        filters.selections.companies.includes(c.id),
    ) || [];
  const incomplete =
    companies.some(
      (c) => !selectedConnections.some((conn) => conn.company_id === c.id),
    ) ||
    !selectedConnections.length ||
    selectedConnections.some(
      (c) =>
        !c.enabled ||
        !c.verified_at ||
        !coversPeriod(
          status?.coverage || status?.jobs || [],
          c.id,
          filters.from,
          filters.to,
        ) ||
        c.last_error,
    );
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
        onClick={() => {
          setEntity(row);
          setDrillPage(1);
          dialog.current?.showModal();
        }}
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
              Combine empresas e origens. Cada produto permanece identificado
              pela sua conta Olist.
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
        <div className="flex gap-2" role="tablist" aria-label="Análises">
          <button
            role="tab"
            aria-selected={draft.grouping !== "customer"}
            className={
              draft.grouping !== "customer" ? "btn-primary" : "btn-ghost"
            }
            onClick={() => {
              setDraft((f) => ({ ...f, grouping: "product" }));
              setFilters((f) => ({ ...f, grouping: "product" }));
              setPage(1);
            }}
          >
            Produtos
          </button>
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
                  </select>
                </label>
              )}
            </div>
            <p className="text-xs text-[var(--color-text-secondary)]">
              Sem produto pai na API, o registro permanece individual. Receita
              líquida após devoluções, CMV e margem exigem dados adicionais e
              não são calculados nesta versão.
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
      {error && (
        <div className="card p-5 text-red-800" role="alert">
          {error}
          {isAdmin && (
            <p className="mt-2">
              <Link href="/ninho" className="underline">
                Verificar conexões no Ninho
              </Link>
            </p>
          )}
        </div>
      )}
      {status && (
        <section
          className={`card p-5 space-y-3 ${incomplete ? "border-amber-300" : "border-green-300"}`}
        >
          <h2 className="font-semibold">
            {incomplete
              ? "Escopo parcial · confira a cobertura antes de concluir"
              : "Histórico importado para o período selecionado"}
          </h2>
          <p className="text-sm text-[var(--color-text-secondary)]">
            {companies.map((c) => c.name).join(" + ") ||
              "Nenhuma empresa cadastrada"}{" "}
            · {filters.from.split("-").reverse().join("/")} a{" "}
            {filters.to.split("-").reverse().join("/")} ·{" "}
            {Object.values(filters.selections).reduce(
              (n, v) => n + (v?.length || 0),
              0,
            )}{" "}
            seleções dimensionais. Valores brutos dos itens; frete e despesas
            excluídos. Situações canceladas excluídas.
          </p>
          <div className="flex flex-wrap gap-3">
            {selectedConnections.map((c) => (
              <div
                key={c.id}
                className="rounded-xl bg-black/[0.025] p-3 text-xs"
              >
                <p className="font-semibold">
                  {c.name}
                  {!c.enabled ? " · pausada" : ""}
                </p>
                <p className="mt-1">
                  {c.verified_at
                    ? "CNPJ validado na API"
                    : "CNPJ ainda não validado na API"}
                </p>
                <p className="mt-1">
                  {c.last_synced_at
                    ? `Última importação: ${new Date(c.last_synced_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
                    : "Histórico ainda não importado"}
                </p>
                {c.last_error && (
                  <p className="text-red-700 max-w-72 mt-1">{c.last_error}</p>
                )}
              </div>
            ))}
          </div>
          {isAdmin && (
            <Link className="text-sm underline text-amber-800" href="/ninho">
              Gerenciar empresas, conexões e importação histórica
            </Link>
          )}
        </section>
      )}
      {loading && (
        <p role="status" className="text-sm py-4">
          Calculando a Curva ABC…
        </p>
      )}
      {result && !loading && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Valor bruto dos itens", money(result.revenue)],
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
          <Pareto
            result={result}
            a={filters.thresholdA}
            b={filters.thresholdB}
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
                      {labels[c]}
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
                          {labels[c]}
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
                      className="border-t border-[var(--color-border-light)] hover:bg-amber-50/50"
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
                    Nenhuma venda elegível neste escopo
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
