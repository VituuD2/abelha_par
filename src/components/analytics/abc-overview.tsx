"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, BarChart3, Donut, Info, Minus, Package, ShoppingCart } from "lucide-react";
import { kpiSnapshot, percentageChange, previousPeriod, type Change, type KPIComparison } from "@/lib/analytics/comparison";
import { signedDecimalUnits } from "@/lib/analytics/engine";
import { money, number, pct } from "@/lib/analytics/format";
import type { ABCFilters, ABCResult } from "@/lib/analytics/types";

type Comparison = { data?: KPIComparison; loading: boolean; message: string | null };
export type ABCOverviewResult = Pick<ABCResult, "revenue" | "quantity" | "orders" | "total" | "top10" | "classes" | "composition">;
const panel = "min-w-0 rounded-[var(--radius-lg)] border border-[var(--color-border-light)] bg-[var(--color-bg-elevated)] shadow-[var(--shadow-sm)]";
const secondary = "text-[var(--color-text-secondary)]";
const colors = {
  A: { icon: "bg-orange-50 text-orange-700", bar: "bg-orange-500", text: "text-orange-700" },
  B: { icon: "bg-amber-50 text-amber-700", bar: "bg-amber-400", text: "text-amber-700" },
  C: { icon: "bg-stone-100 text-stone-600", bar: "bg-stone-400", text: "text-stone-600" },
} as const;

function AnimatedNumber({ value, raw }: { value: string; raw: string | number }) {
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef({ value, raw });
  useEffect(() => {
    const before = previous.current;
    previous.current = { value, raw };
    if (before.value === value || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    let offset = 0;
    try {
      const now = signedDecimalUnits(raw), old = signedDecimalUnits(before.raw);
      offset = now > old ? 7 : now < old ? -7 : 0;
    } catch { /* Keep the fade if the value cannot be compared numerically. */ }
    const animation = element.current?.animate?.([
      { transform: `translateY(${offset}px)`, opacity: 0.4 },
      { transform: "translateY(0)", opacity: 1 },
    ], { duration: 220, easing: "ease-out" });
    return () => animation?.cancel();
  }, [value, raw]);
  return <span ref={element} className="inline-block max-w-full align-bottom [overflow-wrap:anywhere]">{value}</span>;
}

function comparisonRange(filters: ABCFilters) {
  try {
    const period = previousPeriod(filters);
    const date = (value: string) => value.split("-").reverse().join("/");
    return `${date(period.from)} a ${date(period.to)}`;
  } catch { return "Período indisponível"; }
}

function TrendBadge({ change, label, neutral = false }: { change: Change; label?: string; neutral?: boolean }) {
  if (change.kind !== "change") return (
    <span className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-1 text-[11px] font-medium text-stone-600"
      title={change.kind === "zero-base" ? "A base anterior é zero; a variação percentual não é definida." : "Não há dados válidos para calcular esta variação."}>
      <Minus aria-hidden="true" className="h-3 w-3 shrink-0" />{label && `${label}: `}{change.kind === "zero-base" ? "Sem base anterior" : "Indisponível"}
    </span>
  );
  const { direction, negativeBase, tiny, percent } = change;
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const tone = neutral || negativeBase || direction === "flat" ? "neutral" : direction;
  const negative = percent.startsWith("-");
  const sign = direction === "flat" ? "" : negative || (tiny && direction === "down" && !negativeBase) || (tiny && direction === "up" && negativeBase) ? "−" : "+";
  const formatted = tiny ? "<0,1%" : `${number(percent.replace(/^-/, ""))}%`;
  return (
    <span data-trend-direction={direction} data-trend-tone={tone}
      title={`${label ? `${label}: ` : ""}${direction === "up" ? "Aumento" : direction === "down" ? "Queda" : "Sem alteração"} em relação ao período anterior.${negativeBase ? " Base anterior negativa: o sinal da fórmula percentual é invertido; interpretação neutra." : neutral ? " Uma mudança na concentração não indica, por si só, melhora ou piora." : " A cor indica a direção da variação, sem avaliar o resultado do negócio."}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium tabular-nums ${tone === "up" ? "bg-emerald-50 text-emerald-800" : tone === "down" ? "bg-red-50 text-red-800" : "bg-stone-100 text-stone-600"}`}>
      <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="sr-only">{direction === "up" ? "Aumento" : direction === "down" ? "Queda" : "Sem alteração"}: </span>
      <span className="[overflow-wrap:anywhere]">{label && `${label} `}<AnimatedNumber value={sign + formatted} raw={percent} /></span>
    </span>
  );
}

export function ABCOverview(props: {
  result: ABCOverviewResult; filters: ABCFilters; comparison: Comparison; loading: boolean;
}) {
  // Commit the current values and previous-period response together. Keep the
  // visible snapshot during refreshes, including changes to applied filters.
  const [display, setDisplay] = useState(props);
  if (!props.loading && !props.comparison.loading &&
    (display.result !== props.result || display.filters !== props.filters ||
      display.comparison.data !== props.comparison.data || display.comparison.message !== props.comparison.message)) {
    setDisplay(props);
  }
  const { result, filters, comparison } = display;
  const current = kpiSnapshot(result), previous = comparison.data?.previous;
  const message = comparison.message;
  const ready = !message && !comparison.loading && !!previous;
  const range = comparisonRange(filters);
  const indicators = [
    { label: result.composition ? "Valor atribuído aos produtos" : "Valor bruto dos itens", values: [{ value: money(result.revenue), raw: result.revenue }],
      Icon: BarChart3, color: "bg-orange-50 text-orange-600", changes: [{ change: percentageChange(current.revenue, previous?.revenue ?? NaN) }] },
    { label: "Quantidade vendida", values: [{ value: number(result.quantity), raw: result.quantity }], Icon: Package, color: "bg-emerald-50 text-emerald-700",
      changes: [{ change: percentageChange(current.quantity, previous?.quantity ?? NaN) }] },
    { label: "Pedidos / entidades", values: [{ value: number(result.orders), raw: result.orders }, { value: number(result.total), raw: result.total }], Icon: ShoppingCart, color: "bg-blue-50 text-blue-600",
      changes: [{ label: "Pedidos", change: percentageChange(current.orders, previous?.orders ?? NaN) }, { label: "Entidades", change: percentageChange(current.total, previous?.total ?? NaN) }] },
    { label: "Concentração dos 10 primeiros", values: [{ value: pct(result.top10), raw: result.top10 }], Icon: Donut, color: "bg-violet-50 text-violet-600", neutral: true,
      changes: [{ change: percentageChange(current.top10, previous?.top10 ?? NaN) }] },
  ];
  const classKeys = ["A", "B", "C"] as const;
  const distribution = classKeys.map(key => ({ key, ...result.classes?.[key], percent: result.classes?.[key]?.percent ?? 0 }));
  const totalShare = distribution.reduce((sum, entry) => sum + entry.percent, 0);
  const validDistribution = distribution.every(entry => Number.isFinite(entry.percent) && entry.percent >= 0) && totalShare > 0;
  const metric = filters.metric === "quantity" ? "quantidade" : "valor";

  return (
    <>
      <section className={panel} aria-label="Indicadores do período" aria-busy={props.loading || props.comparison.loading}>
        <div className="grid min-w-0 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          {indicators.map(({ label, values, Icon, color, changes, neutral }, index) => (
            <div key={index} className={`flex min-w-0 flex-col gap-4 border-[var(--color-border-light)] px-5 py-6 sm:px-6 ${index ? "border-t xl:border-t-0 xl:border-l" : ""} ${index === 1 ? "sm:border-t-0" : ""} ${index % 2 ? "sm:border-l" : ""}`}>
              <div className="flex min-w-0 items-center gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}><Icon aria-hidden="true" className="h-[19px] w-[19px]" strokeWidth={1.7} /></span>
                <h2 className={`text-[13px] font-medium leading-5 ${secondary}`} title={index === 2 ? "Pedidos distintos / produtos ou clientes no relatório." : index === 3 ? "Participação dos dez primeiros na métrica aplicada." : undefined}>{label}</h2>
              </div>
              <p data-kpi-value className="text-[clamp(1.375rem,2vw,1.875rem)] font-semibold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere]">{values.map((value, i) => <span key={i}>{i > 0 && " / "}<AnimatedNumber {...value} /></span>)}</p>
              <div className="mt-auto space-y-2">
                <div className="flex min-h-6 flex-wrap items-center gap-1.5">
                  <button type="button" title={range} aria-label={`Período comparado: ${range}`} className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${secondary} hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700`}><Info aria-hidden="true" className="h-3.5 w-3.5" /></button>
                  {ready ? changes.map((entry, i) => <TrendBadge key={i} {...entry} neutral={neutral} />)
                    : <span role={index === 0 ? "status" : undefined} title={message || undefined} className={`inline-flex items-center gap-1.5 text-xs ${secondary}`}><Minus aria-hidden="true" className="h-3 w-3" />{comparison.loading ? "—" : "Comparação indisponível"}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={panel} aria-label="Resumo das classes ABC" aria-busy={props.loading || props.comparison.loading}>
        <div className="px-5 pt-5 sm:px-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Distribuição ABC</h2>
            <p className={`text-xs ${secondary}`}>Participação por {metric}</p>
          </div>
          <div role="img" aria-label={validDistribution ? distribution.map(entry => `Classe ${entry.key}: ${pct(entry.percent)}`).join("; ") : "Sem distribuição proporcional disponível"}
            className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-[var(--color-bg-tertiary)]">
            {validDistribution && distribution.map(entry => entry.percent > 0 && <span key={entry.key} className={`h-full ${colors[entry.key].bar}`} style={{ width: `${entry.percent / totalShare * 100}%` }} />)}
          </div>
          {!validDistribution && <p className={`mt-2 text-xs ${secondary}`}>{totalShare === 0 ? "Sem participação nesta métrica." : "A barra não representa participações negativas ou inválidas."}</p>}
        </div>
        <div className="mt-5 grid min-w-0 grid-cols-1 sm:grid-cols-3">
          {classKeys.map((key, index) => {
            const entry = result.classes?.[key], color = colors[key];
            return (
              <div key={key} className={`min-w-0 space-y-4 border-[var(--color-border-light)] px-5 py-5 sm:px-6 ${index ? "border-t sm:border-t-0 sm:border-l" : ""}`}>
                <div className="flex items-center gap-3">
                  <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-2xl font-semibold ${color.icon}`}>{key}</span>
                  <div className="min-w-0"><h3 className="text-[13px] font-semibold">Classe {key}</h3><p className={`mt-0.5 text-xs tabular-nums [overflow-wrap:anywhere] ${secondary}`}>{number(entry?.count || 0)} {filters.grouping === "customer" ? "clientes" : "produtos"}</p></div>
                </div>
                <p className="text-xl font-semibold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere]">{money(entry?.revenue || "0")}</p>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs tabular-nums">
                  <p><span className={`font-semibold ${color.text}`}>{pct(entry?.percent || 0)}</span> <span className={secondary}>da métrica</span></p>
                  <p className={`${secondary} [overflow-wrap:anywhere]`}>{number(entry?.quantity || "0")} unidades</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

export function ABCOverviewSkeleton() {
  return <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
    <div className={`${panel} grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4`}>{[0, 1, 2, 3].map(item => <div key={item} className="space-y-4 p-6"><div className="flex items-center gap-3"><div className="h-10 w-10 rounded-xl bg-[var(--color-bg-tertiary)]" /><div className="h-3 w-1/2 rounded bg-[var(--color-bg-tertiary)]" /></div><div className="h-8 w-3/4 rounded bg-[var(--color-bg-tertiary)]" /><div className="h-4 w-1/2 rounded bg-[var(--color-bg-tertiary)]" /></div>)}</div>
    <div className={`${panel} p-6`}><div className="h-4 w-40 rounded bg-[var(--color-bg-tertiary)]" /><div className="mt-4 h-2 rounded-full bg-[var(--color-bg-tertiary)]" /><div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">{[0, 1, 2].map(item => <div key={item} className="space-y-4"><div className="h-12 w-12 rounded-xl bg-[var(--color-bg-tertiary)]" /><div className="h-6 w-3/4 rounded bg-[var(--color-bg-tertiary)]" /><div className="h-3 w-1/2 rounded bg-[var(--color-bg-tertiary)]" /></div>)}</div></div>
  </div>;
}
