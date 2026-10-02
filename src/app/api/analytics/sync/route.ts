import { after, NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { enqueueSync, processAnalyticsBatch } from "@/lib/analytics/sync";
import { parseABCFilters } from "@/lib/analytics/filters";
import { analyticsStatus, analyticsError } from "@/lib/analytics/server";
import { createAdminClient } from "@/lib/supabase/admin";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await authorize();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(
      await analyticsStatus(auth.access.workspaceId, auth.access.user.id),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return analyticsError(e, 503);
  }
}
export async function POST(request: Request) {
  const auth = await authorize(true);
  if (auth.response) return auth.response;
  try {
    const b = await request.json();
    if (b.action === "retry") {
      const retried = await createAdminClient()
        .from("analytics_sync_jobs")
        .update({
          status: "queued",
          attempts: 0,
          next_at: new Date().toISOString(),
          last_error: null,
          lease_token: null,
          lease_until: null,
        })
        .eq("workspace_id", auth.access.workspaceId)
        .eq("id", b.job)
        .eq("status", "failed")
        .select("id")
        .single();
      if (retried.error)
        throw new Error(
          "Não foi possível retomar este checkpoint. Verifique se já existe outra importação do mesmo período.",
        );
    } else if (b.action !== "continue") {
      const f = parseABCFilters({
        from: b.from,
        to: b.to,
        metric: "revenue",
        grouping: "product",
        mode: "TINY_LEGACY",
        thresholdA: 80,
        thresholdB: 95,
        basis: "orders",
        selections: {},
      });
      if (typeof b.connection !== "string")
        throw new Error("Selecione uma conexão.");
      await enqueueSync(auth.access.workspaceId, b.connection, f.from, f.to);
    }
    after(async () => {
      try {
        await processAnalyticsBatch(auth.access.workspaceId);
      } catch {
        /* Durable job retains its checkpoint; status is visible in Ninho. */
      }
    });
    return NextResponse.json({ queued: true }, { status: 202 });
  } catch (reason) {
    return analyticsError(reason);
  }
}
