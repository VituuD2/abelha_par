import type { ABCRow } from "./types";

export type ParetoHighlight = { entityId: string; cumulative: boolean; origin: "chart" | "table"; targetPercentage?: number };

/** Include the product that crosses the requested threshold, never invent an unrendered point. */
export function paretoAtPercentage(rows: ABCRow[], percentage: number) {
  return rows.find(row => row.cumulative >= percentage) || rows.at(-1) || null;
}

export function paretoHighlighted(row: ABCRow, active: ABCRow | null, cumulative: boolean) {
  return !!active && (cumulative ? row.rank <= active.rank : row.entityId === active.entityId);
}
