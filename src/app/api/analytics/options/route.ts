import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { analyticsStatus, analyticsError } from "@/lib/analytics/server";
import { DIMENSIONS } from "@/lib/analytics/config";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const started = performance.now();
  const auth = await authorize("analytics:read");
  if (auth.response) return auth.response;
  const authorized = performance.now();
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
        headers: { "Cache-Control": "no-store", "Server-Timing": `authorize;dur=${(authorized - started).toFixed(1)}, options;dur=${(performance.now() - authorized).toFixed(1)}` },
      });
    }
    let optionsMs = 0, statusMs = 0;
    const reading = performance.now();
    const [options, status] = await Promise.all([
      createAdminClient().rpc("analytics_options", {
        p_workspace: auth.access.workspaceId,
        p_actor: auth.access.user.id,
      }).then(result => { optionsMs = performance.now() - reading; return result; }),
      analyticsStatus(auth.access.workspaceId, auth.access.user.id).then(result => { statusMs = performance.now() - reading; return result; }),
    ]);
    if (options.error)
      throw new Error("Não foi possível consultar os filtros analíticos.");
    return NextResponse.json(
      { options: options.data, ...status },
      { headers: { "Cache-Control": "no-store", "Server-Timing": `authorize;dur=${(authorized - started).toFixed(1)}, options;dur=${optionsMs.toFixed(1)}, status;dur=${statusMs.toFixed(1)}` } },
    );
  } catch (reason) {
    return analyticsError(reason, 503);
  }
}
