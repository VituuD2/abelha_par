import type { ABCMode, ABCMetric, ABCRow } from "./types";

/** Exact decimal parsing: amounts stay decimal strings or bigint, never accumulated floats. */
export function decimalUnits(value: string | number, scale = 6): bigint {
  const raw = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(raw))
    throw new Error("Valor decimal inválido ou negativo.");
  const [whole, fraction = ""] = raw.split(".");
  const multiplier = BigInt(10) ** BigInt(scale);
  const digits = (fraction + "0".repeat(scale)).slice(0, scale);
  return (
    BigInt(whole) * multiplier +
    BigInt(digits || "0") +
    (Number(fraction[scale] || "0") >= 5 ? BigInt(1) : BigInt(0))
  );
}
export function unitsDecimal(value: bigint, scale = 6): string {
  const sign = value < BigInt(0) ? "-" : "";
  const raw = (value < BigInt(0) ? -value : value)
    .toString()
    .padStart(scale + 1, "0");
  return scale
    ? `${sign}${raw.slice(0, -scale)}.${raw.slice(-scale)}`
    : sign + raw;
}
export function lineCents(
  price: string | number,
  quantity: string | number,
): string {
  const product = decimalUnits(price) * decimalUnits(quantity);
  return ((product + BigInt("5000000000")) / BigInt("10000000000")).toString();
}
export function rankABC(
  input: {
    entityId: string;
    name: string;
    sku: string;
    revenue: string;
    quantity: string;
    orders: number;
  }[],
  metric: ABCMetric = "revenue",
  mode: ABCMode = "TINY_LEGACY",
  a = 80,
  b = 95,
): ABCRow[] {
  if (
    !["revenue", "quantity"].includes(metric) ||
    !["TINY_LEGACY", "STRICT_CUMULATIVE"].includes(mode)
  )
    throw new Error("Métrica ou modo ABC inválido.");
  if (!(a > 0 && a < b && b < 100)) throw new Error("Limites ABC inválidos.");
  const rows = input.map((row) => ({
    ...row,
    value:
      metric === "revenue"
        ? decimalUnits(row.revenue, 0)
        : decimalUnits(row.quantity),
    qty: decimalUnits(row.quantity),
  }));
  rows.sort((x, y) =>
    x.value !== y.value
      ? x.value > y.value
        ? -1
        : 1
      : x.qty !== y.qty
        ? x.qty > y.qty
          ? -1
          : 1
        : x.entityId < y.entityId
          ? -1
          : x.entityId > y.entityId
            ? 1
            : 0,
  );
  const total = rows.reduce((sum, row) => sum + row.value, BigInt(0));
  let accumulated = BigInt(0);
  const percentage = (value: bigint) =>
    total ? Number((value * BigInt(1000000)) / total) / 10000 : 0;
  const thresholdA = decimalUnits(a, 4);
  const thresholdB = decimalUnits(b, 4);
  return rows.map((row, index) => {
    const value = row.value;
    const before = accumulated;
    accumulated += value;
    const boundary = mode === "TINY_LEGACY" ? before : accumulated;
    const scaled = boundary * BigInt(1000000);
    const cls = !total
      ? "C"
      : scaled < total * thresholdA
        ? "A"
        : scaled < total * thresholdB
          ? "B"
          : "C";
    return {
      entityId: row.entityId,
      name: row.name,
      sku: row.sku,
      revenue: row.revenue,
      quantity: row.quantity,
      orders: row.orders,
      rank: index + 1,
      percent: percentage(value),
      cumulativeBefore: percentage(before),
      cumulative: percentage(accumulated),
      class: cls,
    };
  });
}
