import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ScanOrder, StoredScanSession } from "@/types";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const SESSION_FIELDS = "id, responsible, orders, revision, status, batch_id";

export async function readScanSession(ownerId: string, id: string) {
  const { data, error } = await createAdminClient().from("scan_sessions").select(SESSION_FIELDS).eq("owner_id", ownerId).eq("id", id).maybeSingle();
  if (error) throw new Error("Não foi possível carregar a sessão de conferência.");
  return data as StoredScanSession | null;
}

/** Revision comparison serializes simultaneous scans and tracking refreshes. */
export async function updateSessionOrders(ownerId: string, session: StoredScanSession, orders: ScanOrder[]) {
  const { data, error } = await createAdminClient().from("scan_sessions").update({ orders, revision: session.revision + 1, updated_at: new Date().toISOString() })
    .eq("owner_id", ownerId).eq("id", session.id).eq("revision", session.revision).eq("status", "active").select(SESSION_FIELDS).maybeSingle();
  if (error) throw new Error("Não foi possível gravar a conferência. Tente novamente.");
  return data as StoredScanSession | null;
}
