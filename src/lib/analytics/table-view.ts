import type { ABCRow } from "./types";

// Presentation only: keep the server's rank, class and financial values intact.
const searchable = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");

function decimalCompare(a: string, b: string) {
  const [ai, af = ""] = a.split("."), [bi, bf = ""] = b.split(".");
  const scale = Math.max(af.length, bf.length);
  const left = BigInt(`${ai}${af.padEnd(scale, "0")}`);
  const right = BigInt(`${bi}${bf.padEnd(scale, "0")}`);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function revenueDescending<T extends { revenue: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => decimalCompare(b.revenue, a.revenue));
}

export function searchTableRows(rows: readonly ABCRow[], query: string, sort: string, direction: string, customer = false): ABCRow[] {
  const terms = searchable(query.trim()).split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    const text = searchable(`${row.name} ${customer ? "" : row.sku || ""}`);
    return terms.every(term => text.includes(term));
  }).sort((a, b) => {
    let comparison: number;
    if (sort === "revenue" || sort === "quantity") comparison = decimalCompare(a[sort], b[sort]);
    else if (sort === "name" || sort === "sku") comparison = (a[sort] || "") < (b[sort] || "") ? -1 : (a[sort] || "") > (b[sort] || "") ? 1 : 0;
    else if (sort === "orders" || sort === "percent" || sort === "cumulative") comparison = a[sort] - b[sort];
    else comparison = a.rank - b.rank;
    return (direction === "desc" ? -comparison : comparison) || a.rank - b.rank;
  });
}
