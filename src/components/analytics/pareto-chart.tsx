"use client";

import { useId, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { BarChart3 } from "lucide-react";
import { money, number, pct } from "@/lib/analytics/format";
import { paretoAtPercentage, paretoHighlighted, type ParetoHighlight } from "@/lib/analytics/pareto";
import type { ABCResult, ABCRow } from "@/lib/analytics/types";

const left = 48, bottom = 230;
const y = (value: number) => bottom - Math.max(0, Math.min(100, value)) * 1.85;
const classColor = { A: "var(--color-abc-a)", B: "var(--color-abc-b)", C: "var(--color-abc-c)" };

export function ParetoChart({ result, a, b, highlight, onHighlight, onOpen, entityLabel = "produto" }: {
  result: ABCResult;
  a: number;
  b: number;
  highlight: ParetoHighlight | null;
  onHighlight: (value: ParetoHighlight | null) => void;
  onOpen: (row: ABCRow) => void;
  entityLabel?: "produto" | "cliente";
}) {
  const tooltipId = useId();
  const touch = useRef(false);
  const rows = result.pareto, count = rows.length;
  const plot = Math.max(780, count * 10), width = left + plot + 32;
  const x = (index: number) => left + ((index + 0.5) * plot) / count;
  const active = rows.find(row => row.entityId === highlight?.entityId) || null;
  const activeIndex = active ? rows.indexOf(active) : -1;
  const cumulative = !!highlight?.cumulative;
  const select = (row: ABCRow, range = false) => onHighlight({ entityId: row.entityId, cumulative: range, origin: "chart" });
  const clear = () => { if (highlight?.origin === "chart") onHighlight(null); };
  const percent = (value: number) => {
    const row = paretoAtPercentage(rows, value);
    if (row) onHighlight({ entityId: row.entityId, cumulative: true, origin: "chart", targetPercentage: value });
  };
  const path = (items: ABCRow[]) => items.map((row, index) => `${x(index)},${y(row.cumulative)}`).join(" ");
  const inspectPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!count) return;
    touch.current = event.pointerType === "touch";
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const localX = (event.clientX - bounds.left) * width / bounds.width;
    const localY = (event.clientY - bounds.top) * 270 / bounds.height;
    if (localY < 25 || localY > bottom + 12 || localX > left + plot + 8) { clear(); return; }
    if (localX < left) { percent(Math.max(0, Math.min(100, (bottom - localY) / 1.85))); return; }
    const index = Math.max(0, Math.min(count - 1, Math.floor((localX - left) * count / plot)));
    const row = rows[index];
    const isBar = localY >= y(row.percent) - 5;
    select(row, !isBar);
  };

  return (
    <section className="card p-5 sm:p-6 space-y-4" aria-label="Explorar concentração das vendas">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><BarChart3 className="w-[22px] h-[22px] text-[var(--color-accent-blue)]" />Concentração das vendas</h2>
        </div>
        <div className="flex flex-wrap gap-4 text-[13px] text-[var(--color-text-secondary)]">
          <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm bg-[var(--color-abc-chart-accent)]" />Individual</span>
          <span className="flex items-center gap-1.5"><i className="w-[22px] h-0.5 bg-[var(--color-abc-line)]" />Acumulado</span>
          <span className="flex items-center gap-1.5"><i className="h-[14px] w-[14px] rounded-sm bg-[var(--color-abc-a)]" />A</span>
          <span className="flex items-center gap-1.5"><i className="h-[14px] w-[14px] rounded-sm bg-[var(--color-abc-b)]" />B</span>
          <span className="flex items-center gap-1.5"><i className="h-[14px] w-[14px] rounded-sm bg-[var(--color-abc-c)]" />C</span>
        </div>
      </div>
      <div className="relative h-[290px] rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-secondary)]">
        {!count && <p role="status" className="absolute inset-0 flex items-center justify-center p-6 text-center text-[15px] text-[var(--color-text-secondary)]">Sem vendas para representar neste período.</p>}
        <div className="h-full overflow-x-auto rounded-2xl" role="region" tabIndex={0} aria-label="Área rolável do gráfico de Pareto">
          <svg
            className="block w-full cursor-pointer rounded-2xl focus-visible:outline-2 focus-visible:outline-[var(--color-accent-blue)] focus-visible:-outline-offset-2"
            style={{ width, minWidth: "100%", height: 270 }}
            preserveAspectRatio="none"
            viewBox={`0 0 ${width} 270`}
            role="img"
            tabIndex={count ? 0 : -1}
            aria-label={`Gráfico de Pareto: ${result.total} entidades; os dez primeiros concentram ${pct(result.top10)}`}
            aria-describedby={active ? tooltipId : undefined}
            aria-keyshortcuts="ArrowLeft ArrowRight Home End Enter Escape"
            onPointerMove={inspectPointer}
            onPointerDown={inspectPointer}
            onPointerLeave={() => { if (!touch.current) clear(); }}
            onFocus={() => { if (!active && count) select(rows[0]); }}
            onBlur={clear}
            onKeyDown={event => {
              if (!count) return;
              if (event.key === "Escape") { onHighlight(null); return; }
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : Math.max(0, Math.min(count - 1, activeIndex + (event.key === "ArrowLeft" ? -1 : 1)));
                select(rows[next], event.shiftKey);
              } else if ((event.key === "Enter" || event.key === " ") && active) { event.preventDefault(); onOpen(active); }
            }}
            onClick={() => { if (active && !touch.current) onOpen(active); }}
          >
            <defs>
              <linearGradient id={`${tooltipId}-area`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-abc-chart-accent)" stopOpacity="0.16" />
                <stop offset="100%" stopColor="var(--color-abc-chart-accent)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id={`${tooltipId}-range`} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="var(--color-abc-range-start)" />
                <stop offset="100%" stopColor="var(--color-abc-range-end)" />
              </linearGradient>
            </defs>
            {count > 0 && <polygon points={`${left},${bottom} ${path(rows)} ${left + plot},${bottom}`} fill={`url(#${tooltipId}-area)`} pointerEvents="none" />}
            {[0, 25, 50, 75, 100, a, b].filter((v, i, all) => all.indexOf(v) === i).sort((u, v) => u - v).map(value => (
              <g key={value}>
                <line x1={left} x2={left + plot} y1={y(value)} y2={y(value)} stroke={value === a || value === b ? "var(--color-abc-chart-threshold)" : "var(--color-abc-chart-grid)"} strokeDasharray={value === a || value === b ? "5 4" : undefined} />
                {[0, 25, 50, 75, 100].includes(value) && <text x={left - 8} y={y(value) + 4} textAnchor="end" fontSize="12" fill="var(--color-text-secondary)">{value}%</text>}
              </g>
            ))}
            {active && <rect x={cumulative ? left : x(activeIndex) - plot / count / 2} y="30" width={cumulative ? x(activeIndex) - left + plot / count / 2 : plot / count} height={bottom - 30} fill={`url(#${tooltipId}-range)`} opacity="0.8" pointerEvents="none" />}
            {rows.map((row, index) => {
              const selected = paretoHighlighted(row, active, cumulative);
              return <rect
                key={row.entityId}
                data-pareto-bar={row.entityId}
                data-highlighted={selected}
                x={x(index) - plot / count * 0.32}
                y={y(row.percent)}
                width={Math.max(1, plot / count * 0.64)}
                height={Math.max(0, bottom - y(row.percent))}
                rx="1.5"
                fill={classColor[row.class]}
                opacity={active && !selected ? 0.28 : 1}
                stroke={selected ? "var(--color-abc-range-ink)" : "none"}
                strokeWidth={selected ? 1.5 : 0}
                onPointerEnter={() => select(row)}
                onPointerDown={() => select(row)}
              />;
            })}
            <polyline points={path(rows)} fill="none" stroke="var(--color-abc-line)" opacity={active ? 0.35 : 1} strokeWidth="3" strokeLinejoin="round" pointerEvents="none" />
            {active && cumulative && <polyline points={path(rows.slice(0, activeIndex + 1))} fill="none" stroke="var(--color-abc-line)" strokeWidth="3.5" strokeLinejoin="round" pointerEvents="none" />}
            {rows.map((row, index) => <circle key={row.entityId} data-pareto-point={row.entityId} cx={x(index)} cy={y(row.cumulative)} r="6" fill="transparent" onPointerEnter={() => select(row, true)} onPointerDown={() => select(row, true)} />)}
            {active && <g pointerEvents="none">
              <line x1={x(activeIndex)} x2={x(activeIndex)} y1="30" y2={bottom} stroke="var(--color-text-tertiary)" strokeDasharray="3 4" />
              <line x1={left} x2={x(activeIndex)} y1={y(active.cumulative)} y2={y(active.cumulative)} stroke="var(--color-abc-line)" strokeDasharray="3 4" opacity="0.6" />
              <circle cx={x(activeIndex)} cy={y(active.cumulative)} r="8" fill="var(--color-abc-up-soft)" />
              <circle cx={x(activeIndex)} cy={y(active.cumulative)} r="4.5" fill="var(--color-abc-line)" stroke="var(--color-bg-elevated)" strokeWidth="2" />
              <text x={x(activeIndex)} y={bottom + 17} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--color-abc-range-ink)">{active.rank}º</text>
            </g>}
            {!active && count > 0 && <><text x={left} y={bottom + 20} fontSize="12" fill="var(--color-text-secondary)">1º {entityLabel}</text><text x={left + plot} y={bottom + 20} textAnchor="end" fontSize="12" fill="var(--color-text-secondary)">{rows[count - 1].rank}º {entityLabel}</text></>}
          </svg>
        </div>
        {active && <div
          role="tooltip"
          id={tooltipId}
          data-pareto-tooltip
          className={`pointer-events-auto md:pointer-events-none absolute top-3 z-10 w-72 max-w-[calc(100%-1.5rem)] max-h-[264px] overflow-auto rounded-2xl border border-[var(--color-border-medium)] bg-[var(--color-bg-raised)] p-4 shadow-xl backdrop-blur-sm ${activeIndex < count / 2 ? "right-3" : "left-3"}`}
        >
          <div className="flex items-center justify-between gap-2 text-[13px]"><span className="font-semibold text-[var(--color-text-secondary)]">{cumulative ? `Acumulado · ${active.rank} ${entityLabel}s` : `${entityLabel === "cliente" ? "Cliente" : "Produto"} · posição ${active.rank}`}</span><span className="rounded-full px-2 py-0.5 font-semibold" style={{ backgroundColor: `var(--color-abc-${active.class.toLowerCase()}-soft)`, color: `var(--color-abc-${active.class.toLowerCase()}-ink)` }}>Classe {active.class}</span></div>
          <p className="mt-2 text-[15px] font-semibold leading-snug text-[var(--color-text-primary)] line-clamp-3">{active.name}</p>
          <p className="mt-1 truncate font-mono text-[13px] text-[var(--color-text-secondary)]">{active.sku || "Sem SKU"}</p>
          {highlight?.targetPercentage !== undefined && <p className="mt-1 text-[13px] text-[var(--color-abc-up)]">Percentual explorado: {pct(highlight.targetPercentage)}</p>}
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-[var(--color-border-light)] pt-3">
            <div><p className="text-[12px] text-[var(--color-text-secondary)]">Participação individual</p><p className="text-lg font-semibold text-[var(--color-abc-range-ink)]">{pct(active.percent)}</p></div>
            <div><p className="text-[12px] text-[var(--color-text-secondary)]">Acumulado até aqui</p><p className="text-lg font-semibold text-[var(--color-abc-line)]">{pct(active.cumulative)}</p></div>
          </div>
          <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">{money(active.revenue)} · {number(active.quantity)} un. · {number(active.orders)} pedidos</p>
          {cumulative && <p className="mt-2 text-[13px] text-[var(--color-abc-up)]">Destaque do 1º ao {active.rank}º {entityLabel}.{highlight?.targetPercentage !== undefined && active.cumulative < highlight.targetPercentage ? ` Os registros exibidos chegam a ${pct(active.cumulative)}; o percentual solicitado não foi atingido.` : highlight?.targetPercentage !== undefined ? " Inclui o registro que cruza o percentual." : ""}</p>}
          {!result.rows.some(row => row.entityId === active.entityId) && <p className="mt-2 text-[13px] text-[var(--color-text-secondary)]">Este {entityLabel} está fora da página atual da tabela.</p>}
          <div className="md:hidden mt-3 flex items-center gap-3 border-t border-[var(--color-border-light)] pt-3">
            <button type="button" className="text-[13px] font-semibold text-[var(--color-abc-up)] underline underline-offset-4" onClick={() => onOpen(active)}>Ver pedidos</button>
            <button type="button" className="ml-auto text-[13px] text-[var(--color-text-secondary)]" onClick={() => onHighlight(null)}>Limpar destaque</button>
          </div>
        </div>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Explorar participação acumulada">
        <span className="mr-1 text-[13px] text-[var(--color-text-secondary)]">Acumulado até</span>
        {[10, 20, 30, 50, 80, 95, 100].map(value => <button
          key={value}
          type="button"
          disabled={!count}
          className="rounded-lg border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] px-2.5 py-1.5 text-[13px] tabular-nums text-[var(--color-text-secondary)] hover:border-[var(--color-abc-line)] hover:bg-[var(--color-abc-up-soft)] focus-visible:outline-2 focus-visible:outline-[var(--color-abc-line)] aria-pressed:bg-[linear-gradient(135deg,var(--color-abc-range-start),var(--color-abc-range-end))] aria-pressed:text-[var(--color-abc-range-ink)] aria-pressed:border-[var(--color-abc-range-border)]"
          aria-pressed={highlight?.targetPercentage === value}
          aria-label={`Destacar ${entityLabel}s até ${value}% do acumulado`}
          onPointerEnter={() => percent(value)}
          onFocus={() => percent(value)}
          onClick={() => percent(value)}
          onPointerLeave={clear}
          onBlur={clear}
          onKeyDown={event => { if (event.key === "Escape") onHighlight(null); }}
        >{value}%</button>)}
      </div>
    </section>
  );
}
