import { signedDecimalUnits, unitsDecimal } from "./engine";
import type { ABCFilters, ABCResult } from "./types";

export type KPISnapshot = Pick<ABCResult, "revenue" | "quantity" | "orders" | "total" | "top10">;
export type KPIComparison = { period: { from: string; to: string }; previous: KPISnapshot };
export type Change =
  | { kind: "change"; direction: "up" | "down" | "flat"; percent: string; tiny: boolean; negativeBase: boolean }
  | { kind: "zero-base" | "unavailable" };

/** Inclusive calendar days in UTC: independent of browser timezone and daylight saving. */
export function previousPeriod(filters: Pick<ABCFilters, "from" | "to">) {
  const day = 86400000;
  const start = Date.parse(`${filters.from}T00:00:00Z`);
  const end = Date.parse(`${filters.to}T00:00:00Z`);
  const duration = end - start + day;
  const from = new Date(start - duration).toISOString().slice(0, 10);
  const to = new Date(start - day).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to))
    throw new Error("O período anterior está fora do intervalo de datas suportado.");
  return { from, to };
}

export function kpiSnapshot(result: KPISnapshot): KPISnapshot {
  return {
    revenue: result.revenue, quantity: result.quantity, orders: result.orders,
    total: result.total, top10: result.top10,
  };
}

function decimalText(value: string | number) {
  const raw = String(value);
  if (typeof value !== "number" || !/[eE]/.test(raw)) return raw;
  const [coefficient, exponent] = raw.toLowerCase().split("e");
  const negative = coefficient.startsWith("-");
  const [whole, fraction = ""] = coefficient.replace(/^-/, "").split(".");
  const digits = whole + fraction, point = whole.length + Number(exponent);
  const expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
    : `${digits.slice(0, point)}.${digits.slice(point)}`;
  return (negative ? "-" : "") + expanded;
}

/** Compute with exact decimal integers; only round the displayed variation to 0.1%. */
export function percentageChange(current: string | number, previous: string | number): Change {
  try {
    const currentText = decimalText(current), previousText = decimalText(previous);
    const scale = Math.max(currentText.split(".")[1]?.length || 0, previousText.split(".")[1]?.length || 0);
    const now = signedDecimalUnits(currentText, scale), before = signedDecimalUnits(previousText, scale);
    if (before === BigInt(0)) return { kind: "zero-base" };
    const delta = now - before;
    const numerator = delta * BigInt(1000);
    const absolute = (value: bigint) => value < BigInt(0) ? -value : value;
    const magnitude = (absolute(numerator) + absolute(before) / BigInt(2)) / absolute(before);
    const negative = (numerator < BigInt(0)) !== (before < BigInt(0));
    return {
      kind: "change", direction: delta > BigInt(0) ? "up" : delta < BigInt(0) ? "down" : "flat",
      percent: unitsDecimal(negative ? -magnitude : magnitude, 1),
      tiny: magnitude === BigInt(0) && delta !== BigInt(0), negativeBase: before < BigInt(0),
    };
  } catch { return { kind: "unavailable" }; }
}
