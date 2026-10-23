import { NextResponse } from "next/server";
import { recordWebhook } from "@/lib/olist-sync";
import { isValidOlistConnectionWebhookSignature, isValidOlistWebhookSignature } from "@/lib/olist-webhook";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ ownerId: string; signature: string }> }
) {
  const { ownerId, signature } = await params;
  const notFound = () => NextResponse.json({ error: "Webhook não encontrado." }, { status: 404 });
  if (!UUID.test(ownerId) || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return notFound();
  const db = createAdminClient();
  const { data: connection, error: connectionError } = await db.from("analytics_connections")
    .select("id,workspace_id,enabled,webhook_secret").eq("id", ownerId).maybeSingle();
  if (connectionError) return NextResponse.json({ error: "Não foi possível verificar o webhook." }, { status: 503 });
  if (connection && (!connection.enabled || !isValidOlistConnectionWebhookSignature(connection.id, signature, connection.webhook_secret))) {
    return notFound();
  }
  const workspaceId = connection?.workspace_id || ownerId;
  const { data: workspace, error } = await db.from("workspaces")
    .select("olist_webhook_enabled, olist_webhook_revision").eq("id", workspaceId).maybeSingle();
  if (error) return NextResponse.json({ error: "Não foi possível verificar o webhook." }, { status: 503 });
  if (!workspace?.olist_webhook_enabled || (!connection && !isValidOlistWebhookSignature(ownerId, signature, workspace.olist_webhook_revision))) {
    return notFound();
  }
  let connectionId = connection?.id;
  if (!connection) {
    const { data: legacy, error: legacyError } = await db.from("analytics_connections")
      .select("id,enabled").eq("workspace_id", workspaceId).eq("credential_kind", "legacy")
      .not("legacy_integration_id", "is", null).maybeSingle();
    if (legacyError) return NextResponse.json({ error: "Não foi possível verificar o webhook." }, { status: 503 });
    if (legacy && !legacy.enabled) return notFound();
    connectionId = legacy?.id;
  }

  try {
    if (connectionId) {
      const { data: received, error: receiptError } = await db.from("analytics_connections")
        .update({ webhook_last_received_at: new Date().toISOString() }).eq("workspace_id", workspaceId)
        .eq("id", connectionId).select("id").maybeSingle();
      if (receiptError || !received) throw new Error("Recebimento indisponível.");
    }
    if (!connection) await recordWebhook(workspaceId);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    // Receipt failures remain retryable; this endpoint does not process orders.
    return NextResponse.json({ error: "Não foi possível registrar o webhook." }, { status: 500 });
  }
}
