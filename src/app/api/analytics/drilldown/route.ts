import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseABCFilters } from "@/lib/analytics/filters";
import { analyticsError } from "@/lib/analytics/server";
export async function POST(request: Request) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  try {
    const body = await request.json(),
      filters = parseABCFilters(body.filters),
      page = Number(body.page || 1);
    if (
      typeof body.entity !== "string" ||
      body.entity.length > 250 ||
      !Number.isSafeInteger(page) ||
      page < 1
    )
      throw new Error("Entidade inválida.");
    const { data, error } = await createAdminClient().rpc(
      "analytics_drilldown",
      {
        p_workspace: auth.access.workspaceId,
        p_actor: auth.access.user.id,
        p_filters: filters,
        p_entity: body.entity,
        p_offset: (page - 1) * 50,
      },
    );
    if (error)
      throw new Error("Não foi possível abrir os pedidos desta entidade.");
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (reason) {
    return analyticsError(reason);
  }
}
