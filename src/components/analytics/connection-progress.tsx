import type { CoverageJob } from "@/lib/analytics/coverage";

type ProgressJob = CoverageJob & {
  processed?: number; cursor_date?: string; pending_index?: number;
  page_offset?: number; last_error?: string | null;
};
const date = (value: string) => value.split("-").reverse().join("/");
export function ConnectionProgress({ connection, jobs, coverage }: {
  connection: string; jobs: ProgressJob[]; coverage: CoverageJob[];
}) {
  const spans = coverage.filter((j) => j.connection_id === connection);
  const pending = jobs.filter((j) => j.connection_id === connection && j.status !== "completed");
  return (
    <div className="text-xs space-y-1" aria-live="polite">
      <p>Cobertura confirmada: {spans.length
        ? spans.map((s) => `${date(s.from_date)} a ${date(s.to_date)}`).join("; ")
        : "nenhum período concluído"}.</p>
      {spans.length > 1 && <p>Há lacunas entre os intervalos cobertos.</p>}
      {pending.map((j, index) => (
        <p key={`${j.from_date}:${j.mode}:${index}`}>
          {date(j.from_date)} a {date(j.to_date)} · {j.status === "failed" ? "Ação necessária" : "Importação em andamento"}
          {` · ${j.processed || 0} pedidos processados`}
          {j.cursor_date && ` · dia ${date(j.cursor_date)}`}
          {j.page_offset !== undefined && ` · posição ${j.page_offset + (j.pending_index || 0)}`}
          {j.last_error && ` · ${j.last_error}`}
        </p>
      ))}
    </div>
  );
}
