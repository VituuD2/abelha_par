import type { CoverageJob } from "@/lib/analytics/coverage";

type ProgressJob = CoverageJob & {
  id?: string; error_code?: string | null; next_at?: string;
  processed?: number; cursor_date?: string; pending_index?: number;
  page_offset?: number; last_error?: string | null;
};
const date = (value: string) => value.split("-").reverse().join("/");
export function ConnectionProgress({ connection, jobs, coverage, compact = false, enabled = true, onRetry, busy }: {
  connection: string; jobs: ProgressJob[]; coverage: CoverageJob[];
  compact?: boolean; enabled?: boolean; onRetry?: (id: string) => void; busy?: boolean;
}) {
  const spans = coverage.filter((j) => j.connection_id === connection).sort((a, b) => a.from_date.localeCompare(b.from_date));
  const pending = jobs.filter((j) => j.connection_id === connection && j.status !== "completed");
  let through = "", gaps = false;
  for (const span of spans) {
    if (through && Date.parse(span.from_date) > Date.parse(through) + 86400000) gaps = true;
    if (span.to_date > through) through = span.to_date;
  }
  const label = (job: ProgressJob) => !enabled ? "Pausada" : job.status === "failed" ? "Ação necessária"
    : job.status === "retry" ? "Retomada programada" : job.status === "queued" ? "Na fila"
    : job.status === "running" ? "Importando" : job.status === "completed" ? "Concluída" : "Aguardando";
  const active = pending.find(j => j.status === "failed") || pending.find(j => j.status === "running") || pending[0];
  if (compact) return <div className="space-y-2 text-[13px]" aria-live="polite">
    <div className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-bg-secondary)] px-3 py-2">
      <span className="text-[var(--color-text-secondary)]">Importação</span>
      <span className={`font-medium ${active?.status === "failed" ? "text-[var(--color-abc-range-ink)]" : ""}`}>{!enabled ? "Pausada" : active ? label(active) : spans.length ? "Sem fila pendente" : "Aguardando"}</span>
    </div>
    <details>
      <summary className="cursor-pointer font-medium">Histórico e progresso{gaps ? " · cobertura parcial" : ""}</summary>
      <div className="mt-3 space-y-3">
        <p className="text-[var(--color-text-secondary)]">Cobertura: {spans.length ? spans.map(s => `${date(s.from_date)} a ${date(s.to_date)}`).join("; ") : "nenhum período concluído"}</p>
        {pending.map((job, index) => <div key={job.id || index} className="space-y-1 border-t border-[var(--color-border-light)] pt-2">
          <p className="font-medium">{job.mode === "backfill" ? "Histórico" : "Atualizações"} · {label(job)}</p>
          <p>{date(job.from_date)} a {date(job.to_date)} · {(job.processed || 0).toLocaleString("pt-BR")} eventos processados</p>
          {job.cursor_date && <p className="text-[var(--color-text-secondary)]">Dia {date(job.cursor_date)}{job.page_offset !== undefined && ` · posição ${job.page_offset + (job.pending_index || 0)}`}</p>}
          {job.status === "retry" && job.next_at && <p>Nova tentativa a partir de {new Date(job.next_at).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}</p>}
          {job.last_error && <p className="text-[var(--color-abc-range-ink)]">{job.last_error}</p>}
          {enabled && job.status === "failed" && !job.error_code && job.id && onRetry && <button className="btn-ghost" disabled={busy} onClick={() => onRetry(job.id!)}>Tentar novamente</button>}
        </div>)}
      </div>
    </details>
  </div>;
  return (
    <div className="text-[13px] space-y-1" aria-live="polite">
      <p>Cobertura confirmada: {spans.length
        ? spans.map((s) => `${date(s.from_date)} a ${date(s.to_date)}`).join("; ")
        : "nenhum período concluído"}.</p>
      {gaps && <p>Há lacunas entre os intervalos cobertos.</p>}
      {pending.map((j, index) => (
        <p key={`${j.from_date}:${j.mode}:${index}`}>
          {date(j.from_date)} a {date(j.to_date)} · {label(j)}
          {` · ${j.processed || 0} pedidos processados`}
          {j.cursor_date && ` · dia ${date(j.cursor_date)}`}
          {j.page_offset !== undefined && ` · posição ${j.page_offset + (j.pending_index || 0)}`}
          {j.last_error && ` · ${j.last_error}`}
        </p>
      ))}
    </div>
  );
}
