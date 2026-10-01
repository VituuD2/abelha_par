import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { UUID } from "@/lib/scan-session-server";

export async function GET() {
  const { access, response: denied } = await authorize();
  if (denied) return denied;
  const supabase = await createClient();
  const { data, error } = await supabase.from("lotes_bipagem").select("id, numero_lote, responsavel, data, qtd_pedidos, pedidos, created_at").eq("workspace_id", access.workspaceId).order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 500 });
  return NextResponse.json({ batches: data });
}

export async function POST(request: Request) {
  const { access, response: denied } = await authorize();
  if (denied) return denied;
  const user = access.user;
  let body: { sessionId?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (typeof body.sessionId !== "string" || !UUID.test(body.sessionId)) return NextResponse.json({ error: "Sessão inválida." }, { status: 400 });
  const { data, error } = await createAdminClient().rpc("finish_workspace_scan_session", { p_workspace: access.workspaceId, p_actor: user.id, p_session: body.sessionId });
  if (error) return NextResponse.json({ error: "Não foi possível finalizar. Verifique se todos os pedidos foram bipados e tente novamente." }, { status: 409 });
  return NextResponse.json({ ok: true, batch: data }, { status: 201 });
}
