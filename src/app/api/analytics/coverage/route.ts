import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { parseABCFilters } from "@/lib/analytics/filters";
import { ensureFilterCoverage } from "@/lib/analytics/sync";
import { analyticsError } from "@/lib/analytics/server";

export const dynamic = "force-dynamic";

/** Schedule durable work independently of reading the report; never run a worker. */
export async function POST(request: Request) {
  const started = performance.now();
  const auth = await authorize("analytics:read");
  if (auth.response) return auth.response;
  const authorized = performance.now();
  let filters;
  try {
    const body = await request.json();
    filters = parseABCFilters(body?.filters);
  } catch (reason) { return analyticsError(reason); }
  try {
    const scheduling = performance.now();
    const sync = await ensureFilterCoverage(auth.access.workspaceId, auth.access.user.id, filters);
    return NextResponse.json({ sync }, { headers: {
      "Cache-Control": "no-store",
      "Server-Timing": `authorize;dur=${(authorized - started).toFixed(1)}, coverage;dur=${(performance.now() - scheduling).toFixed(1)}`,
    } });
  } catch (reason) {
    return analyticsError(reason, 503);
  }
}
