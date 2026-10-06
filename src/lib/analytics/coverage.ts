export interface CoverageJob {
  connection_id: string;
  mode: string;
  status: string;
  from_date: string;
  to_date: string;
  covers_sales?: boolean;
}
/** Completed adjacent intervals may cover a requested range; gaps must remain visible. */
export function coversPeriod(
  jobs: CoverageJob[],
  connection: string,
  from: string,
  to: string,
): boolean {
  const spans = jobs
    .filter(
      (j) =>
        j.connection_id === connection &&
        (j.mode === "backfill" || j.covers_sales === true) &&
        j.status === "completed",
    )
    .sort((a, b) => a.from_date.localeCompare(b.from_date));
  let cursor = from;
  for (const span of spans) {
    if (span.to_date < cursor) continue;
    if (span.from_date > cursor) return false;
    if (span.to_date >= to) return true;
    cursor = new Date(Date.parse(span.to_date + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10);
  }
  return false;
}
