import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getValidTinyToken } from "@/lib/tiny-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Invoked hourly by Supabase Cron; independent of order traffic and browser sessions.
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  try {
    const accessDeadline = new Date(Date.now() + 65 * 60_000).toISOString();
    const refreshDeadline = new Date(Date.now() + 6 * 60 * 60_000).toISOString();
    const { data, error } = await createAdminClient().from("tiny_integrations")
      .select("workspace_id").not("workspace_id", "is", null)
      .or(`expires_at.lte.${accessDeadline},refresh_expires_at.lte.${refreshDeadline}`)
      .order("updated_at", { ascending: true }).limit(11).abortSignal(AbortSignal.timeout(3_000));
    if (error) throw new Error("storage unavailable");
    // Bound the work within Hobby's runtime. Never include owners or credentials in the response.
    const due = data || [];
    const results = await Promise.all(due.slice(0, 10).map(row => getValidTinyToken(row.workspace_id, 65 * 60_000)));
    const renewed = results.filter(result => result.status === "refreshed").length;
    const reconnect = results.filter(result => result.status === "expired").length;
    const failed = results.filter(result => result.status === "error" || (result.status === "valid" && result.message)).length;
    const ok = !reconnect && !failed && due.length <= 10;
    const summary = { ok, checked: results.length, renewed, reconnect, failed, morePending: due.length > 10 };
    if (!ok) console.warn("[olist-token-refresh] attention required", summary);
    return NextResponse.json(summary, { status: ok ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, error: "Não foi possível executar a renovação Olist." }, { status: 503 });
  }
}
