import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { error } = await createAdminClient()
    .from("tiny_integrations")
    .delete()
    .eq("owner_id", user.id);

  if (error) {
    console.error("[tiny-oauth] failed to remove connection", { userId: user.id, error });
    return NextResponse.json({ error: "Não foi possível remover a conexão Tiny." }, { status: 500 });
  }

  console.info("[tiny-oauth] connection removed", { userId: user.id });
  return NextResponse.json({ removed: true }, { headers: { "Cache-Control": "no-store" } });
}
