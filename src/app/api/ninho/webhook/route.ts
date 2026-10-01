import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAppUrl } from "@/lib/app-url";
import { getOlistWebhookUrl, getOlistWebhookStatus } from "@/lib/olist-webhook";

export async function GET(request: Request) {
  const { access, response: denied } = await authorize(true);
  if (denied) return denied;
  const { data, error } = await createAdminClient().from("workspaces").select("olist_webhook_enabled, olist_webhook_revision").eq("id", access.workspaceId).single();
  if (error) return NextResponse.json({ error: "Não foi possível verificar o webhook." }, { status: 503 });
  return NextResponse.json({ enabled: data.olist_webhook_enabled, url: getOlistWebhookUrl(getAppUrl(request), access.workspaceId, data.olist_webhook_revision), status: await getOlistWebhookStatus(access.workspaceId) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { access, response: denied } = await authorize(true);
  if (denied) return denied;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  if (!["enable", "disable", "rotate"].includes(body.action)) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const { error } = await createAdminClient().rpc("configure_workspace_webhook", { p_workspace: access.workspaceId, p_actor: access.user.id, p_action: body.action });
  if (error) return NextResponse.json({ error: "Não foi possível alterar o webhook." }, { status: 503 });
  return NextResponse.json({ ok: true });
}
