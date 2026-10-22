"use client";

import { Download, LoaderCircle } from "lucide-react";
import type { ABCFilters } from "@/lib/analytics/types";

const modes = [
  { value: "product", label: "Produtos Olist" },
  { value: "composition", label: "Produtos base" },
  { value: "customer", label: "Clientes" },
] as const;

export function ABCModeTabs({ grouping, onChange }: {
  grouping: ABCFilters["grouping"];
  onChange: (grouping: ABCFilters["grouping"]) => void;
}) {
  return (
    <section aria-label="Modo de análise" className="min-w-0">
      <div
        role="tablist"
        aria-label="Análises"
        className="app-tabs"
      >
        {modes.map((tab, index) => {
          const selected = grouping === tab.value || (tab.value === "product" && grouping === "parent");
          return (
            <button
              key={tab.value}
              id={`abc-tab-${tab.value}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls="abc-analysis-panel"
              tabIndex={selected ? 0 : -1}
              className="app-tab !text-[14px] flex-1 sm:flex-none"
              onClick={() => onChange(tab.value)}
              onKeyDown={event => {
                if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === "Home" ? 0 : event.key === "End" ? 2
                  : (index + (event.key === "ArrowRight" ? 1 : 2)) % modes.length;
                const group = modes[next].value;
                onChange(group);
                document.getElementById(`abc-tab-${group}`)?.focus();
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function ABCExportActions({ busy, disabled, onDownload }: {
  busy: boolean;
  disabled: boolean;
  onDownload: (format: "csv" | "xlsx") => void;
}) {
  return (
    <details className="relative" onKeyDown={event => {
      if (event.key === "Escape") {
        event.currentTarget.open = false;
        event.currentTarget.querySelector("summary")?.focus();
      }
    }}>
      <summary
        aria-busy={busy}
        className="btn-ghost list-none !border-[var(--color-border-medium)] [&::-webkit-details-marker]:hidden"
      >
        {busy
          ? <LoaderCircle aria-hidden="true" className="w-[17px] h-[17px] motion-safe:animate-spin" />
          : <Download aria-hidden="true" className="w-[17px] h-[17px]" />}
        Exportar
      </summary>
      <div
        aria-label="Exportar relatório completo"
        className="absolute right-0 top-full z-30 mt-2 w-52 rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-elevated)] p-2 shadow-md"
      >
        <button disabled={busy || disabled} className="btn-ghost w-full justify-start" onClick={() => onDownload("csv")}>
          CSV completo
        </button>
        <button disabled={busy || disabled} className="btn-ghost w-full justify-start" onClick={() => onDownload("xlsx")}>
          Excel
        </button>
        <p role={busy ? "status" : undefined} className="px-3 py-2 text-[13px] text-[var(--color-text-secondary)]">
          {busy ? "Preparando arquivo…" : "Todos os registros dos filtros aplicados."}
        </p>
      </div>
    </details>
  );
}
