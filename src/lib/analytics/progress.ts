/** Ignore heartbeat timestamps: report math only needs to rerun on real progress. */
export function progressVersion(state: {
  jobs: { id?: string; connection_id: string; mode?: string; from_date?: string; to_date?: string; status: string; processed?: number; cursor_date?: string; pending_index?: number; page_offset?: number; query_phase?: string; last_error?: string | null }[];
  connections: { id: string; enabled: boolean; verified_at?: string | null; last_synced_at?: string | null; last_error?: string | null }[];
  coverage?: unknown[];
  costSync?: import("./types").CostSyncStatus | null;
}) {
  return JSON.stringify({
    connections: state.connections.map((c) => JSON.stringify([c.id, c.enabled, c.verified_at, c.last_synced_at, c.last_error])).sort(),
    jobs: state.jobs.map((j) => JSON.stringify([j.id, j.connection_id, j.mode, j.from_date, j.to_date, j.status, j.processed, j.cursor_date, j.page_offset, j.pending_index, j.query_phase, j.last_error])).sort(),
    coverage: state.coverage?.map((span) => JSON.stringify(span)).sort(),
    costs: state.costSync && [state.costSync.connection_id, state.costSync.updated_at, state.costSync.last_synced_at, state.costSync.last_error, state.costSync.history],
  });
}
