import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { parseABCFilters } from "@/lib/analytics/filters";
import { report, analyticsError } from "@/lib/analytics/server";
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
    return NextResponse.json(
      await report(
        auth.access,
        filters,
        (page - 1) * size,
        size,
        body.sort || "rank",
        body.direction || "asc",
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (reason) {
    return analyticsError(reason);
  }
}
