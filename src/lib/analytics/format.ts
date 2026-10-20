import { signedDecimalUnits } from "./engine";

export function money(cents: string) {
  const value = signedDecimalUnits(cents, 0), absolute = value < BigInt(0) ? -value : value;
  return `${value < BigInt(0) ? "−" : ""}R$ ${(absolute / BigInt(100)).toLocaleString("pt-BR")},${(absolute % BigInt(100)).toString().padStart(2, "0")}`;
}
export function number(value: string | number): string {
  if (typeof value === "number") return value.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const [whole, fraction = ""] = value.split("."), tail = fraction.replace(/0+$/, "");
  return `${BigInt(whole || "0").toLocaleString("pt-BR")}${tail ? "," + tail : ""}`;
}
export const pct = (value: number) => `${number(value)}%`;
