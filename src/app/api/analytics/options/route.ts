import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyticsStatus, analyticsError } from "@/lib/analytics/server";
import { DIMENSIONS } from "@/lib/analytics/config";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  try {
    const params = new URL(request.url).searchParams,
      dimension = params.get("dimension"),
      search = params.get("q") || "";
    if (dimension) {
      if (!(dimension in DIMENSIONS) || search.length > 160)
        throw new Error("Busca dimensional inválida.");
      const found = await createAdminClient().rpc("analytics_options", {
        p_workspace: auth.access.workspaceId,
        p_actor: auth.access.user.id,
        p_dimension: dimension,
        p_search: search,
      });
      if (found.error) throw new Error("Não foi possível buscar as opções.");
      return NextResponse.json(found.data, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const [options, status] = await Promise.all([
      createAdminClient().rpc("analytics_options", {
        p_workspace: auth.access.workspaceId,
        p_actor: auth.access.user.id,
      }),
      analyticsStatus(auth.access.workspaceId, auth.access.user.id),
    ]);
    if (options.error)
      throw new Error("Não foi possível consultar os filtros analíticos.");
    return NextResponse.json(
      { options: options.data, ...status },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (reason) {
    return analyticsError(reason, 503);
  }
}
