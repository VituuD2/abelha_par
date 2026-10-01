import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export type Role = "admin" | "operator";
export type AccessContext = { user: User; workspaceId: string; role: Role; displayName: string };

export class AccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function getAccessContext(user?: User | null): Promise<AccessContext | null> {
  const authenticated = user === undefined ? await getAuthenticatedUser() : user;
  if (!authenticated) return null;
  const { data, error } = await createAdminClient().from("workspace_members")
    .select("workspace_id, role, active, display_name").eq("user_id", authenticated.id).maybeSingle();
  if (error) throw new AccessError("Não foi possível verificar suas permissões. Confira a atualização do banco para o Ninho.", 503);
  if (!data?.active) throw new AccessError("Seu acesso está bloqueado ou ainda não foi liberado por um administrador.", 403);
  if (data.role !== "admin" && data.role !== "operator") throw new AccessError("Perfil de acesso inválido.", 403);
  return { user: authenticated, workspaceId: data.workspace_id, role: data.role, displayName: data.display_name || "" };
}

/** Every operation checks membership again; hiding a button is not authorization. */
export async function authorize(adminOnly = false): Promise<{ access: AccessContext; response?: never } | { access?: never; response: NextResponse }> {
  try {
    const access = await getAccessContext();
    if (!access) return { response: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) };
    if (adminOnly && access.role !== "admin") return { response: NextResponse.json({ error: "Somente administradores podem acessar o Ninho e alterar configurações." }, { status: 403 }) };
    return { access };
  } catch (error) {
    return { response: NextResponse.json({ error: error instanceof AccessError ? error.message : "Não foi possível verificar suas permissões." }, { status: error instanceof AccessError ? error.status : 503 }) };
  }
}
