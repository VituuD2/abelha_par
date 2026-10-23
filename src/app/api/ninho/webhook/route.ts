import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/app-url";
import { getOlistConnectionWebhookUrl, getOlistWebhookUrl, getOlistWebhookStatus } from "@/lib/olist-webhook";

export async function GET(request: Request) {
  const { access, response: denied } = await authorize("integrations:manage");
  if (denied) return denied;
  const db = createAdminClient(), appUrl = getAppUrl(request);
  const [{ data, error }, { data: connections, error: connectionsError }] = await Promise.all([
    db.from("workspaces").select("olist_webhook_enabled, olist_webhook_revision").eq("id", access.workspaceId).single(),
    db.from("analytics_connections").select("id,name,webhook_secret,webhook_last_received_at").eq("workspace_id", access.workspaceId).order("name"),
  ]);
  if (error || connectionsError) return NextResponse.json({ error: "Não foi possível verificar o webhook." }, { status: 503 });
  return NextResponse.json({ enabled: data.olist_webhook_enabled, url: getOlistWebhookUrl(appUrl, access.workspaceId, data.olist_webhook_revision), status: await getOlistWebhookStatus(access.workspaceId),
    connections: (connections || []).map(connection => ({ id: connection.id, name: connection.name,
      url: getOlistConnectionWebhookUrl(appUrl, connection.id, connection.webhook_secret), lastReceivedAt: connection.webhook_last_received_at })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { access, response: denied } = await authorize("integrations:manage");
  if (denied) return denied;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  if (!["enable", "disable", "rotate"].includes(body.action)) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const { error } = await createAdminClient().rpc("configure_workspace_webhook", { p_workspace: access.workspaceId, p_actor: access.user.id, p_action: body.action });
  if (error) return NextResponse.json({ error: "Não foi possível alterar o webhook." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
