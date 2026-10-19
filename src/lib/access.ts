import "server-only";

import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { cache } from "react";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { can, type Permission, type Role } from "@/lib/permissions";

export type { Role } from "@/lib/permissions";
export type AccessContext = { user: User; workspaceId: string; role: Role; displayName: string };

export class AccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Deduplicate layouts/page guards only within a React server request.
// Route handlers still query membership on every operation.
const readMembership = cache(async (userId: string) => {
  const { data, error } = await createAdminClient().from("workspace_members")
    .select("workspace_id, role, active, display_name").eq("user_id", userId).maybeSingle();
  if (error) throw new AccessError("Não foi possível verificar suas permissões. Confira a atualização do banco para o Ninho.", 503);
  return data;
});

export async function getAccessContext(user?: User | null): Promise<AccessContext | null> {
  const authenticated = user === undefined ? await getAuthenticatedUser() : user;
  if (!authenticated) return null;
  const data = await readMembership(authenticated.id);
  if (data?.active !== true) throw new AccessError("Seu acesso está bloqueado ou ainda não foi liberado por um administrador.", 403);
  if (data.role !== "admin" && data.role !== "operator") throw new AccessError("Perfil de acesso inválido.", 403);
  if (typeof data.workspace_id !== "string" || !data.workspace_id) throw new AccessError("Vínculo com a colmeia inválido.", 403);
  return { user: authenticated, workspaceId: data.workspace_id, role: data.role, displayName: data.display_name || "" };
}

/** Every operation checks membership again; hiding a button is not authorization. */
export async function authorize(permission: Permission = "app:access"): Promise<{ access: AccessContext; response?: never } | { access?: never; response: NextResponse }> {
  const deny = (error: string, status: number) => NextResponse.json({ error }, {
    status, headers: { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" },
  });
  try {
    const access = await getAccessContext();
    if (!access) return { response: deny("Não autorizado", 401) };
    if (!can(access.role, permission)) return { response: deny("Você não tem permissão para acessar este recurso.", 403) };
    return { access };
  } catch (error) {
    return { response: deny(error instanceof AccessError ? error.message : "Não foi possível verificar suas permissões.", error instanceof AccessError ? error.status : 503) };
  }
}
