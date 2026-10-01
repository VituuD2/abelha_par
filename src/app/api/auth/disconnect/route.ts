import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST() {
  const { access, response: denied } = await authorize(true);
  if (denied) return denied;
  const user = access.user;

  const { error } = await createAdminClient()
    .from("tiny_integrations")
    .delete()
    .eq("workspace_id", access.workspaceId);

  if (error) {
    console.error("[tiny-oauth] failed to remove connection", { userId: user.id, error });
    return NextResponse.json({ error: "Não foi possível remover a conexão Tiny." }, { status: 500 });
  }

  console.info("[tiny-oauth] connection removed", { userId: user.id });
  const response = NextResponse.json({ removed: true }, { headers: { "Cache-Control": "no-store" } });
  for (const path of ["/", "/api/auth"]) {
    response.cookies.set("tiny_oauth_state", "", { path, maxAge: 0 });
    response.cookies.set("tiny_oauth_user", "", { path, maxAge: 0 });
    response.cookies.set("tiny_oauth_flow", "", { path, maxAge: 0 });
  }
  return response;
}
