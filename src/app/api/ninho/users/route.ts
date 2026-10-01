import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { UUID } from "@/lib/scan-session-server";
import { isRateLimited } from "@/lib/rate-limit";

export async function GET() {
  const { access, response: denied } = await authorize(true);
  if (denied) return denied;
  const db = createAdminClient();
  const { data, error } = await db.from("workspace_members").select("user_id, display_name, role, active, created_at")
    .eq("workspace_id", access.workspaceId).order("created_at");
  if (error) return NextResponse.json({ error: "Não foi possível carregar os usuários." }, { status: 503 });
  const users = await Promise.all((data || []).map(async member => {
    const { data, error } = await db.auth.admin.getUserById(member.user_id);
    return error ? null : { ...member, email: data.user.email || "" };
  }));
  if (users.some(user => !user)) return NextResponse.json({ error: "Não foi possível consultar as contas. Tente novamente." }, { status: 503 });
  return NextResponse.json({ users, currentUserId: access.user.id }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const { access, response: denied } = await authorize(true);
  if (denied) return denied;
  if (isRateLimited(`ninho-create:${access.user.id}`, 10, 60_000)) return NextResponse.json({ error: "Aguarde um minuto para criar mais usuários." }, { status: 429 });
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Dados de usuário inválidos." }, { status: 400 });
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || name.length < 2 || name.length > 100
    || password.length < 12 || password.length > 128 || !["admin", "operator"].includes(body.role)) {
    return NextResponse.json({ error: "Informe nome, e-mail, perfil e uma senha de 12 a 128 caracteres." }, { status: 400 });
  }
  const db = createAdminClient();
  const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name } });
  if (error || !data.user) return NextResponse.json({ error: error?.code === "email_exists" ? "Este e-mail já possui uma conta." : "Não foi possível criar a conta. Confira o e-mail e a senha." }, { status: 400 });
  const { error: membershipError } = await db.rpc("add_workspace_member", { p_workspace: access.workspaceId, p_actor: access.user.id, p_user: data.user.id, p_name: name, p_role: body.role });
  if (membershipError) {
    const { error: cleanupError } = await db.auth.admin.deleteUser(data.user.id);
    if (cleanupError) console.error("[ninho] account without membership requires cleanup", { userId: data.user.id });
    return NextResponse.json({ error: "Não foi possível liberar o acesso da conta. Atualize a lista e tente novamente." }, { status: 503 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  const { access, response: denied } = await authorize(true);
  if (denied) return denied;
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Dados de usuário inválidos." }, { status: 400 });
  if (typeof body.userId !== "string" || !UUID.test(body.userId) || !["admin", "operator"].includes(body.role) || typeof body.active !== "boolean") {
    return NextResponse.json({ error: "Usuário ou permissão inválida." }, { status: 400 });
  }
  const { error } = await createAdminClient().rpc("update_workspace_member", {
    p_workspace: access.workspaceId, p_actor: access.user.id, p_user: body.userId, p_role: body.role, p_active: body.active,
  });
  if (error) return NextResponse.json({ error: error.message.includes("LAST_ADMIN") ? "Mantenha ao menos um administrador ativo no Ninho." : "Não foi possível alterar as permissões deste usuário." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
