import { coversPeriod, type CoverageJob } from "./coverage";
import type { ABCFilters } from "./types";

export interface CoverageStatus {
  companies: { id: string; name: string }[];
  sources?: { id: string; connection_id: string }[];
  connections: {
    id: string; company_id: string; name: string; enabled: boolean;
    verified_at?: string | null; last_synced_at?: string | null; last_error?: string | null;
  }[];
  jobs: (CoverageJob & { last_error?: string | null })[];
  coverage?: CoverageJob[];
}

/** Import coverage proves scanning, never financial reconciliation against the ERP. */
export function reportReliability(status: CoverageStatus, filters: ABCFilters) {
  const selected = filters.selections;
  const connections = status.connections.filter(c =>
    (!selected.companies?.length || selected.companies.includes(c.company_id)) &&
    (!selected.connections?.length || selected.connections.includes(c.id)) &&
    (!selected.sources?.length || status.sources?.some(s => s.connection_id === c.id && selected.sources?.includes(s.id))));
  const companies = status.companies.filter(c =>
    (!selected.companies?.length || selected.companies.includes(c.id)) &&
    (!(selected.connections?.length || selected.sources?.length) || connections.some(conn => conn.company_id === c.id)));
  const coverage = status.coverage || status.jobs;
  const jobs = status.jobs.filter(j => connections.some(c => c.id === j.connection_id) &&
    j.from_date <= filters.to && j.to_date >= filters.from && j.status !== "completed");
  const syncFailed = connections.some(c => c.last_error) || jobs.some(j => j.status === "failed" || j.last_error);
  const complete = !!connections.length && companies.every(c => connections.some(conn => conn.company_id === c.id)) &&
    connections.every(c => c.enabled && c.verified_at && coversPeriod(coverage, c.id, filters.from, filters.to)) && !syncFailed;
  const state = syncFailed ? "sync_error" : complete ? "covered" :
    jobs.some(j => ["queued", "running", "retry"].includes(j.status)) ? "importing" : "uncovered";
  const emptyTitle = state === "sync_error" ? "Não foi possível confirmar as vendas: sincronização com falha" :
    state === "importing" ? "Importação em andamento · ainda não há resultado elegível" :
    state === "uncovered" ? "Histórico não confirmado para este período" : "Nenhuma venda elegível neste escopo";
  return { connections, companies, complete, state, emptyTitle };
}
