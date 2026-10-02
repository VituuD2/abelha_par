import { ABC_DEFAULTS, DIMENSIONS } from "./config";
import type { ABCFilters, Dimension } from "./types";

export function parseABCFilters(value: unknown): ABCFilters {
  if (!value || typeof value !== "object")
    throw new Error("Filtros inválidos.");
  const f = value as Record<string, unknown>;
  const date = (v: unknown) =>
    typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(v) &&
    new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
  if (
    !date(f.from) ||
    !date(f.to) ||
    String(f.from) > String(f.to) ||
    Date.parse(String(f.to)) - Date.parse(String(f.from)) > 3660 * 86400000
  )
    throw new Error("Informe um período válido de até dez anos.");
  if (f.metric !== "revenue" && f.metric !== "quantity")
    throw new Error("Métrica inválida.");
  if (f.mode !== "TINY_LEGACY" && f.mode !== "STRICT_CUMULATIVE")
    throw new Error("Modo ABC inválido.");
  if (!["product", "parent", "customer"].includes(String(f.grouping)))
    throw new Error("Agrupamento inválido.");
  if (!["orders", "invoiced"].includes(String(f.basis)))
    throw new Error("Base de venda inválida.");
  const a = Number(f.thresholdA),
    b = Number(f.thresholdB);
  if (!(Number.isFinite(a) && Number.isFinite(b) && a > 0 && a < b && b < 100))
    throw new Error("Os limites precisam obedecer 0 < A < B < 100.");
  const selections: ABCFilters["selections"] = {};
  const raw = f.selections;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Seleções inválidas.");
  for (const [key, values] of Object.entries(raw)) {
    if (
      !(key in DIMENSIONS) ||
      !Array.isArray(values) ||
      values.length > 200 ||
      values.some((v) => typeof v !== "string" || v.length > 200)
    )
      throw new Error("Dimensão ou seleção inválida.");
    selections[key as Dimension] = [...new Set(values as string[])];
  }
  if (!("statuses" in selections))
    selections.statuses = ABC_DEFAULTS.statuses.map(String);
  return {
    from: String(f.from),
    to: String(f.to),
    metric: f.metric,
    mode: f.mode,
    grouping: f.grouping as ABCFilters["grouping"],
    basis: f.basis as ABCFilters["basis"],
    thresholdA: a,
    thresholdB: b,
    selections,
  };
}
