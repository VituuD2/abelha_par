import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { parseABCFilters } from "@/lib/analytics/filters";
import { report, analyticsError } from "@/lib/analytics/server";
import { previousPeriod, kpiSnapshot } from "@/lib/analytics/comparison";
import type { ABCResult } from "@/lib/analytics/types";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorize("analytics:read");
  if (auth.response) return auth.response;
  try {
    const body = await request.json();
    const filters = parseABCFilters(body.filters);
    const period = previousPeriod(filters);
    // Same canonical SQL, trusted workspace, catalog and historical CMV rules.
    // No table rows requested and no ranking/pareto data sent to the browser.
    const result = await report(auth.access, { ...filters, ...period }, 0, 0) as ABCResult;
    return NextResponse.json({ period, previous: kpiSnapshot(result) }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (reason) { return analyticsError(reason); }
}
