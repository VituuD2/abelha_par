import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { parseABCFilters } from "@/lib/analytics/filters";
import { report, analyticsError } from "@/lib/analytics/server";
import { ensureFilterCoverage } from "@/lib/analytics/sync";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const auth = await authorize();
  if (auth.response) return auth.response;
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
    const result = await report(
        auth.access,
        filters,
        (page - 1) * size,
        size,
        body.sort || "rank",
        body.direction || "asc",
      );
    // Return existing data even if scheduling is temporarily unavailable.
    let sync;
    try {
      sync = await ensureFilterCoverage(auth.access.workspaceId, auth.access.user.id, filters);
    } catch (reason) {
      sync = { error: reason instanceof Error ? reason.message : "Agendamento indisponível." };
    }
    return NextResponse.json(
      { ...result, sync },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (reason) {
    return analyticsError(reason);
  }
}
