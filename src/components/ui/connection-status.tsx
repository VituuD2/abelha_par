import type { ConnectionHealth } from "@/lib/connection-status";

export function ConnectionStatus({ health }: { health: ConnectionHealth }) {
  const colors = health.tone === "success" ? "bg-emerald-50 text-emerald-800 border-emerald-200"
    : health.tone === "warning" ? "bg-amber-50 text-amber-900 border-amber-200"
    : "bg-stone-100 text-stone-600 border-stone-200";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${colors}`}>
    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{health.label}
  </span>;
}
