import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { AccessContext } from "@/lib/access";
import type { ABCFilters } from "./types";
import { compositionRulesForWorkspace } from "./composition-server";
import { costSyncStatus } from "./cost-sync";
import { ABC_DEFAULTS } from "./config";

class HistoricalCostUnavailable extends Error {
  readonly code = "HISTORICAL_COST_UNAVAILABLE";
  constructor(readonly costBasis: NonNullable<ABCFilters["costBasis"]>, readonly missingCostSkus: string[]) {
    super(`CMV unitário histórico indisponível na base ${costBasis === "average" ? "Custo médio" : "Custo de compra"} da Olist 1 para ${missingCostSkus.join(", ")}. O valor dessa base pode estar zerado, ausente ou sem vigência anterior ou igual à data da venda. ${costBasis === "average" ? "Selecione Custo de compra por vigência para usar o histórico de compra, se disponível. " : "Confira os valores e as datas no histórico de custos da Olist 1. "}Para consultar as quantidades enquanto isso, selecione a métrica Quantidade.`);
  }
}

export function analyticsError(reason: unknown, status = 400) {
  return NextResponse.json(
    {
      ...(reason instanceof HistoricalCostUnavailable ? {
        code: reason.code, costBasis: reason.costBasis, missingCostSkus: reason.missingCostSkus,
      } : {}),
      error:
        reason instanceof Error
          ? reason.message
          : "A camada analítica está indisponível. Confira a migração v11.",
    },
    { status: reason instanceof HistoricalCostUnavailable ? 422 : status, headers: { "Cache-Control": "no-store" } },
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
  const composed = filters.grouping === "composition";
  const { data, error } = await createAdminClient().rpc(composed ? "analytics_abc_components_v19" : "analytics_abc", {
    p_workspace: access.workspaceId,
    p_actor: access.user.id,
    p_filters: { ...filters, costBasis: filters.costBasis || ABC_DEFAULTS.costBasis },
    ...(composed ? { p_rules: compositionRulesForWorkspace(access.workspaceId) } : {}),
    p_offset: offset,
    p_limit: limit,
    p_sort: sort,
    p_direction: direction,
  });
  if (error && composed && error.message.includes("CMV_REQUIRED:"))
    throw new HistoricalCostUnavailable(filters.costBasis || ABC_DEFAULTS.costBasis,
      error.message.split("CMV_REQUIRED:")[1].split(",").map((sku: string) => sku.trim()).filter(Boolean));
  if (error)
    throw new Error(
      error.message.includes("MEMBER_REQUIRED")
        ? "Seu acesso mudou. Entre novamente."
        : composed
          ? "Não foi possível consultar os produtos base. Confira a migração v19 e tente novamente."
          : "Não foi possível consultar a Curva ABC. Confira a migração v11 e tente novamente.",
    );
  return data;
}
export async function analyticsStatus(workspace: string, actor: string) {
  const db = createAdminClient();
  const [companies, connections, jobs, sources, coverage, costSync] = await Promise.all([
    db
      .from("analytics_companies")
      .select("id,name,tax_id")
      .eq("workspace_id", workspace)
      .order("name"),
    db
      .from("analytics_connections")
      .select(
        "id,company_id,name,enabled,credential_kind,legacy_integration_id,verified_tax_id,verified_at,expires_at,last_synced_at,last_error,error_code,client_id",
      )
      .eq("workspace_id", workspace)
      .order("name"),
    db.rpc("analytics_job_status", { p_workspace: workspace, p_actor: actor }),
    db
      .from("analytics_sources")
      .select(
        "id,connection_id,name,channel,kind,marketplace,store,external_account",
      )
      .eq("workspace_id", workspace)
      .order("name"),
    db.rpc("analytics_coverage", { p_workspace: workspace, p_actor: actor }),
    costSyncStatus(workspace),
  ]);
  if ([companies, connections, jobs, sources, coverage].some((r) => r.error))
    throw new Error(
      "Curva ABC ainda não disponível no banco. Aplique as migrações v11 e v12.",
    );
  return {
    companies: companies.data || [],
    connections: connections.data || [],
    jobs: jobs.data || [],
    sources: sources.data || [],
    coverage: coverage.data || [],
    costSync,
  };
}
