"use client";

import { useId, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { BarChart3, MousePointer2 } from "lucide-react";
import { money, number, pct } from "@/lib/analytics/format";
import { paretoAtPercentage, paretoHighlighted, type ParetoHighlight } from "@/lib/analytics/pareto";
import type { ABCResult, ABCRow } from "@/lib/analytics/types";

const width = 860, left = 48, plot = 780, bottom = 230;
const y = (value: number) => bottom - Math.max(0, Math.min(100, value)) * 1.85;
const classColor = { A: "#d97706", B: "#eab308", C: "#a8a29e" };

export function ParetoChart({ result, a, b, highlight, onHighlight, onOpen, entityLabel = "produto" }: {
  result: ABCResult;
  a: number;
  b: number;
  highlight: ParetoHighlight | null;
  onHighlight: (value: ParetoHighlight | null) => void;
  onOpen: (row: ABCRow) => void;
  entityLabel?: "produto" | "cliente";
}) {
  const tooltipId = useId(), hintId = useId();
  const touch = useRef(false);
  const rows = result.pareto, count = rows.length;
  if (!count) return null;
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
  const path = (items: ABCRow[]) => items.map(row => `${x(rows.indexOf(row))},${y(row.cumulative)}`).join(" ");
  const inspectPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
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
          <h2 className="font-semibold flex items-center gap-2"><BarChart3 className="w-5 h-5 text-amber-700" />Concentração das vendas</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">Explore um {entityLabel} na barra ou o conjunto acumulado na curva.</p>
        </div>
        <div className="flex gap-4 text-xs text-stone-600">
          <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm bg-amber-600" />Individual</span>
          <span className="flex items-center gap-1.5"><i className="w-5 h-0.5 bg-emerald-600" />Acumulado</span>
        </div>
      </div>
      <div className="relative md:min-h-[290px] rounded-2xl border border-stone-200/80 bg-gradient-to-b from-stone-50/60 to-white">
        <div className="overflow-x-auto rounded-2xl">
          <svg
            className="block w-full min-w-[540px] rounded-2xl focus-visible:outline-2 focus-visible:outline-amber-600 focus-visible:-outline-offset-2"
            viewBox={`0 0 ${width} 270`}
            role="img"
            tabIndex={0}
            aria-label={`Gráfico de Pareto: ${result.total} entidades; os dez primeiros concentram ${pct(result.top10)}`}
            aria-describedby={`${hintId}${active ? ` ${tooltipId}` : ""}`}
            onPointerMove={inspectPointer}
            onPointerDown={inspectPointer}
            onPointerLeave={() => { if (!touch.current) clear(); }}
            onFocus={() => { if (!active) select(rows[0]); }}
            onBlur={clear}
            onKeyDown={event => {
              if (event.key === "Escape") { onHighlight(null); return; }
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? count - 1 : Math.max(0, Math.min(count - 1, activeIndex + (event.key === "ArrowLeft" ? -1 : 1)));
                select(rows[next], event.shiftKey);
              } else if ((event.key === "Enter" || event.key === " ") && active) { event.preventDefault(); onOpen(active); }
            }}
            onClick={() => { if (active && !touch.current) onOpen(active); }}
          >
            {[0, 25, 50, 75, 100, a, b].filter((v, i, all) => all.indexOf(v) === i).sort((u, v) => u - v).map(value => (
              <g key={value}>
                <line x1={left} x2={left + plot} y1={y(value)} y2={y(value)} stroke={value === a || value === b ? "#c6a66b" : "#e7e5e4"} strokeDasharray={value === a || value === b ? "5 4" : undefined} />
                {[0, 25, 50, 75, 100].includes(value) && <text x={left - 8} y={y(value) + 4} textAnchor="end" fontSize="11" fill="#78716c">{value}%</text>}
              </g>
            ))}
            {active && <rect x={cumulative ? left : x(activeIndex) - plot / count / 2} y="30" width={cumulative ? x(activeIndex) - left + plot / count / 2 : plot / count} height={bottom - 30} fill="#fef3c7" opacity="0.6" pointerEvents="none" />}
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
                stroke={selected ? "#92400e" : "none"}
                strokeWidth={selected ? 1.5 : 0}
                onPointerEnter={() => select(row)}
                onPointerDown={() => select(row)}
              />;
            })}
            <polyline points={path(rows)} fill="none" stroke="#059669" opacity={active ? 0.35 : 1} strokeWidth="2.8" strokeLinejoin="round" pointerEvents="none" />
            {active && cumulative && <polyline points={path(rows.slice(0, activeIndex + 1))} fill="none" stroke="#047857" strokeWidth="3.5" strokeLinejoin="round" pointerEvents="none" />}
            {rows.map((row, index) => <circle key={row.entityId} data-pareto-point={row.entityId} cx={x(index)} cy={y(row.cumulative)} r="6" fill="transparent" onPointerEnter={() => select(row, true)} onPointerDown={() => select(row, true)} />)}
            {active && <g pointerEvents="none">
              <line x1={x(activeIndex)} x2={x(activeIndex)} y1="30" y2={bottom} stroke="#a8a29e" strokeDasharray="3 4" />
              <line x1={left} x2={x(activeIndex)} y1={y(active.cumulative)} y2={y(active.cumulative)} stroke="#059669" strokeDasharray="3 4" opacity="0.6" />
              <circle cx={x(activeIndex)} cy={y(active.cumulative)} r="8" fill="#d1fae5" />
              <circle cx={x(activeIndex)} cy={y(active.cumulative)} r="4.5" fill="#047857" stroke="white" strokeWidth="2" />
              <text x={x(activeIndex)} y={bottom + 17} textAnchor="middle" fontSize="11" fontWeight="700" fill="#92400e">{active.rank}º</text>
            </g>}
            {!active && <><text x={left} y={bottom + 20} fontSize="11" fill="#78716c">1º {entityLabel}</text><text x={left + plot} y={bottom + 20} textAnchor="end" fontSize="11" fill="#78716c">{rows[count - 1].rank}º {entityLabel}</text></>}
          </svg>
        </div>
        {active && <div
          role="tooltip"
          id={tooltipId}
          data-pareto-tooltip
          className={`pointer-events-auto md:pointer-events-none relative m-3 md:m-0 md:absolute md:top-3 z-10 md:w-72 md:max-w-[calc(100%-1.5rem)] rounded-2xl border border-stone-200 bg-white/95 p-4 shadow-xl backdrop-blur-sm ${activeIndex < count / 2 ? "md:right-3" : "md:left-3"}`}
        >
          <div className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-stone-500">{cumulative ? `Acumulado · ${active.rank} ${entityLabel}s` : `${entityLabel === "cliente" ? "Cliente" : "Produto"} · posição ${active.rank}`}</span><span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900">Classe {active.class}</span></div>
          <p className="mt-2 text-sm font-semibold leading-snug text-stone-900 line-clamp-3">{active.name}</p>
          <p className="mt-1 truncate font-mono text-xs text-stone-500">{active.sku || "Sem SKU"}</p>
          {highlight?.targetPercentage !== undefined && <p className="mt-1 text-xs text-emerald-800">Percentual explorado: {pct(highlight.targetPercentage)}</p>}
          <div className="mt-3 grid grid-cols-2 gap-3 border-t border-stone-100 pt-3">
            <div><p className="text-[11px] text-stone-500">Participação individual</p><p className="text-lg font-semibold text-amber-800">{pct(active.percent)}</p></div>
            <div><p className="text-[11px] text-stone-500">Acumulado até aqui</p><p className="text-lg font-semibold text-emerald-700">{pct(active.cumulative)}</p></div>
          </div>
          <p className="mt-2 text-xs text-stone-600">{money(active.revenue)} · {number(active.quantity)} un. · {number(active.orders)} pedidos</p>
          {cumulative && <p className="mt-2 text-xs text-emerald-800">Destaque do 1º ao {active.rank}º {entityLabel}.{highlight?.targetPercentage !== undefined && active.cumulative < highlight.targetPercentage ? ` Os registros exibidos chegam a ${pct(active.cumulative)}; o percentual solicitado não foi atingido.` : highlight?.targetPercentage !== undefined ? " Inclui o registro que cruza o percentual." : ""}</p>}
          {!result.rows.some(row => row.entityId === active.entityId) && <p className="mt-2 text-xs text-stone-500">Este {entityLabel} está fora da página atual da tabela.</p>}
          <div className="md:hidden mt-3 flex items-center gap-3 border-t border-stone-100 pt-3">
            <button type="button" className="text-xs font-semibold text-emerald-800 underline underline-offset-4" onClick={() => onOpen(active)}>Ver pedidos</button>
            <button type="button" className="ml-auto text-xs text-stone-500" onClick={() => onHighlight(null)}>Limpar destaque</button>
          </div>
        </div>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Explorar participação acumulada">
        <span className="mr-1 text-xs text-stone-500">Acumulado até</span>
        {[10, 20, 30, 50, 80, 95, 100].map(value => <button
          key={value}
          type="button"
          className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-xs tabular-nums text-stone-600 hover:border-emerald-400 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-emerald-600"
          aria-label={`Destacar ${entityLabel}s até ${value}% do acumulado`}
          onPointerEnter={() => percent(value)}
          onFocus={() => percent(value)}
          onClick={() => percent(value)}
          onPointerLeave={clear}
          onBlur={clear}
          onKeyDown={event => { if (event.key === "Escape") onHighlight(null); }}
        >{value}%</button>)}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-secondary)]">
        <p id={hintId} className="flex items-center gap-1.5"><MousePointer2 className="h-3.5 w-3.5 shrink-0" />Passe o mouse ou toque. Use ← →; Shift destaca o acumulado; Enter abre pedidos; Esc limpa.</p>
        <p>Referências A: {a}% · B: {b}%</p>
      </div>
      {result.total > count && <p className="text-xs text-stone-500">Exibindo os primeiros {count} de {result.total} registros, que chegam a {pct(rows[count - 1].cumulative)}. Percentuais além desse ponto destacam apenas os registros exibidos; o acumulado considera o conjunto completo.</p>}
    </section>
  );
}
