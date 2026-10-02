import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScanOrder, ScanSubmission, StoredScanSession } from "@/types";
import { applyScan } from "@/lib/scan-session";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SESSION_FIELDS = "id, responsible, orders, revision, status, batch_id";

export async function readScanSession(workspaceId: string, id: string) {
  const { data, error } = await createAdminClient().from("scan_sessions").select(SESSION_FIELDS).eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
  if (error) throw new Error("Não foi possível carregar a sessão de conferência.");
  return data as StoredScanSession | null;
}

/** Revision comparison serializes simultaneous scans and tracking refreshes. */
export async function updateSessionOrders(workspaceId: string, session: StoredScanSession, orders: ScanOrder[], actorId: string) {
  const { data, error } = await createAdminClient().from("scan_sessions").update({ orders, last_updated_by: actorId, revision: session.revision + 1, updated_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId).eq("id", session.id).eq("revision", session.revision).eq("status", "active").select(SESSION_FIELDS).maybeSingle();
  if (error) throw new Error("Não foi possível gravar a conferência. Tente novamente.");
  return data as StoredScanSession | null;
}

export class ScanSubmissionError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Validate and save under one database row lock instead of two network round trips. */
export async function submitSessionScan(workspaceId: string, id: string, actorId: string, code: string, revision: number | null): Promise<{ payload: ScanSubmission; mode: "atomic" | "legacy" }> {
  const { data, error } = await createAdminClient().rpc("submit_workspace_scan", {
    p_workspace: workspaceId, p_actor: actorId, p_session: id, p_code: code, p_revision: revision,
  });
  if (!error) {
    if (!data) throw new Error("Resposta de confirmação inválida.");
    return { payload: data as ScanSubmission, mode: "atomic" };
  }
  if (error.message.includes("SESSION_NOT_FOUND")) throw new ScanSubmissionError("Sessão não encontrada.", 404);
  if (error.message.includes("SESSION_CLOSED")) throw new ScanSubmissionError("Este lote já foi finalizado.", 409);
  if (error.message.includes("MEMBER_REQUIRED")) throw new ScanSubmissionError("Seu acesso está bloqueado ou não foi liberado.", 403);
  // Keep existing deployments usable before migration v10. Never retry uncertain writes.
  if (error.code !== "PGRST202" && error.code !== "42883") throw new Error("Não foi possível gravar a conferência.");
  for (let attempt = 0; attempt < 4; attempt++) {
    const session = await readScanSession(workspaceId, id);
    if (!session) throw new ScanSubmissionError("Sessão não encontrada.", 404);
    if (session.status !== "active") throw new ScanSubmissionError("Este lote já foi finalizado.", 409);
    const { orders, result } = applyScan(session.orders, code);
    if (result.type === "error") return { payload: { session, result }, mode: "legacy" };
    const saved = await updateSessionOrders(workspaceId, session, orders, actorId);
    if (saved) return { payload: { session: saved, result }, mode: "legacy" };
  }
  throw new ScanSubmissionError("Outra leitura está sendo gravada. Tente novamente.", 409);
}
