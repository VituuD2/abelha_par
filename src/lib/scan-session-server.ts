import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScanOrder, StoredScanSession } from "@/types";

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
