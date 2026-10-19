import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { UUID } from "@/lib/scan-session-server";

export async function GET(request: Request) {
  const { access, response: denied } = await authorize();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") || "").trim();
  const page = Number(params.get("page") || "1");
  const size = 20;
  if (query.length > 200 || !Number.isSafeInteger(page) || page < 1 || page > 100000)
    return NextResponse.json({ error: "Busca ou página inválida." }, { status: 400 });
  const supabase = await createClient();
  const headers = { "Cache-Control": "private, no-store" };
  if (query) {
    const { data, error } = await supabase.rpc("search_workspace_batches", {
      p_workspace: access.workspaceId, p_query: query, p_offset: (page - 1) * size, p_limit: size,
    }).abortSignal(request.signal);
    if (error) return NextResponse.json({ error: ["PGRST202", "42883"].includes(error.code)
      ? "A busca no histórico precisa da migração v17. A listagem de lotes continua disponível ao limpar a busca."
      : "Não foi possível pesquisar os pedidos. Tente novamente." }, { status: 503, headers });
    return NextResponse.json({ ...data, page, size }, { headers });
  }
  const { data, error, count } = await supabase.from("lotes_bipagem")
    .select("id, numero_lote, responsavel, data, qtd_pedidos, pedidos, created_at", { count: "exact" })
    .eq("workspace_id", access.workspaceId).order("created_at", { ascending: false }).order("id", { ascending: false })
    .range((page - 1) * size, page * size - 1).abortSignal(request.signal);
  if (error) return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 500 });
  return NextResponse.json({ batches: data, total: count || 0, page, size }, { headers });
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
