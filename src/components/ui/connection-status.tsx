import type { ConnectionHealth } from "@/lib/connection-status";

export function ConnectionStatus({ health }: { health: ConnectionHealth }) {
  const colors = health.tone === "success" ? "bg-[var(--color-success-soft)] text-[var(--color-accent-green)] border-[color-mix(in_srgb,var(--color-accent-green)_25%,transparent)]"
    : health.tone === "warning" ? "bg-[var(--color-accent-soft)] text-[var(--color-accent-blue)] border-[color-mix(in_srgb,var(--color-accent-blue)_25%,transparent)]"
    : "bg-[var(--color-bg-tertiary)] text-[var(--color-text-secondary)] border-[var(--color-border-medium)]";
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${colors}`}>
    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />{health.label}
  </span>;
}
