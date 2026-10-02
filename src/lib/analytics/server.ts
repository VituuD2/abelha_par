import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AccessContext } from "@/lib/access";
import type { ABCFilters } from "./types";

export function analyticsError(reason: unknown, status = 400) {
  return NextResponse.json(
    {
      error:
        reason instanceof Error
          ? reason.message
          : "A camada analítica está indisponível. Confira a migração v11.",
    },
    { status },
  );
}
export async function report(
  access: AccessContext,
  filters: ABCFilters,
  offset = 0,
  limit = 50,
  sort = "rank",
  direction = "asc",
) {
  const { data, error } = await createAdminClient().rpc("analytics_abc", {
    p_workspace: access.workspaceId,
    p_actor: access.user.id,
    p_filters: filters,
    p_offset: offset,
    p_limit: limit,
    p_sort: sort,
    p_direction: direction,
  });
  if (error)
    throw new Error(
      error.message.includes("MEMBER_REQUIRED")
        ? "Seu acesso mudou. Entre novamente."
        : "Não foi possível consultar a Curva ABC. Confira a migração v11 e tente novamente.",
    );
  return data;
}
export async function analyticsStatus(workspace: string, actor: string) {
  const db = createAdminClient();
  const [companies, connections, jobs, sources, coverage] = await Promise.all([
    db
      .from("analytics_companies")
      .select("id,name,tax_id")
      .eq("workspace_id", workspace)
      .order("name"),
    db
      .from("analytics_connections")
      .select(
        "id,company_id,name,enabled,credential_kind,legacy_integration_id,verified_tax_id,verified_at,expires_at,last_synced_at,last_error,client_id",
      )
      .eq("workspace_id", workspace)
      .order("name"),
    db
      .from("analytics_sync_jobs")
      .select(
        "id,connection_id,mode,from_date,to_date,cursor_date,page_offset,pending_index,processed,pages,status,last_error,updated_at,next_at",
      )
      .eq("workspace_id", workspace)
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("analytics_sources")
      .select(
        "id,connection_id,name,channel,kind,marketplace,store,external_account",
      )
      .eq("workspace_id", workspace)
      .order("name"),
    db.rpc("analytics_coverage", { p_workspace: workspace, p_actor: actor }),
  ]);
  if ([companies, connections, jobs, sources, coverage].some((r) => r.error))
    throw new Error(
      "Curva ABC ainda não disponível no banco. Aplique a migração v11.",
    );
  return {
    companies: companies.data || [],
    connections: connections.data || [],
    jobs: jobs.data || [],
    sources: sources.data || [],
    coverage: coverage.data || [],
  };
}
