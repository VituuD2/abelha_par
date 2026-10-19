import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { parseABCFilters } from "@/lib/analytics/filters";
import { report, analyticsError } from "@/lib/analytics/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const started = performance.now();
  const auth = await authorize("analytics:read");
  if (auth.response) return auth.response;
  const authorized = performance.now();
  try {
    const body = await request.json();
    const filters = parseABCFilters(body.filters);
    const page = Number(body.page || 1),
      size = Number(body.size || 50);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      ![25, 50, 100].includes(size) ||
      ![
        "rank",
        "revenue",
        "quantity",
        "orders",
        "name",
        "sku",
        "percent",
        "cumulative",
      ].includes(body.sort || "rank") ||
      !["asc", "desc"].includes(body.direction || "asc")
    )
      throw new Error("Paginação ou ordenação inválida.");
    let reportMs = 0, coverageMs = 0;
    const querying = performance.now();
    const result = await report(
        auth.access,
        filters,
        (page - 1) * size,
        size,
        body.sort || "rank",
        body.direction || "asc",
      );
    reportMs = performance.now() - querying;
    // Preserve older clients. The dashboard schedules through /coverage so this
    // read does not wait for scheduling locks or load the import worker module.
    const scheduling = async () => {
      if (body.ensureCoverage === false) return undefined;
      const schedulingStarted = performance.now();
      try {
        const { ensureFilterCoverage } = await import("@/lib/analytics/sync");
        return await ensureFilterCoverage(auth.access.workspaceId, auth.access.user.id, filters);
      } catch (reason) {
        return { error: reason instanceof Error ? reason.message : "Agendamento indisponível." };
      } finally { coverageMs = performance.now() - schedulingStarted; }
    };
    const sync = await scheduling();
    return NextResponse.json(
      { ...result, sync },
      { headers: {
        "Cache-Control": "no-store",
        "Server-Timing": `authorize;dur=${(authorized - started).toFixed(1)}, report;dur=${reportMs.toFixed(1)}, coverage;dur=${coverageMs.toFixed(1)}`,
      } },
    );
  } catch (reason) {
    return analyticsError(reason);
  }
}
