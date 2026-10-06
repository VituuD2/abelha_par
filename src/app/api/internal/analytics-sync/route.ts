import { NextResponse } from "next/server";
import {
  enqueueIncremental,
  processAnalyticsBatch,
} from "@/lib/analytics/sync";
import { refreshDueAnalyticsTokens } from "@/lib/analytics/auth";
import { timingSafeEqual } from "crypto";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(request.headers.get("authorization") || "");
  const expected = Buffer.from(`Bearer ${secret || ""}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const started = Date.now();
    const renewal = await refreshDueAnalyticsTokens();
    await enqueueIncremental();
    const budget = 45000 - (Date.now() - started);
    if (budget < 15000)
      return NextResponse.json({ processed: 0, pending: true, renewal }, { status: renewal.reconnect || renewal.failed ? 503 : 200 });
    const result = await processAnalyticsBatch(undefined, budget);
    return NextResponse.json(
      { ...result, renewal, ...(renewal.reconnect ? { guidance: "Reconecte a conta indicada no Ninho para retomar seu checkpoint." } : {}) },
      { status: result.error || renewal.reconnect || renewal.failed ? 503 : 200 },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Falha no processamento analítico. Confira os checkpoints e a migração v12.",
      },
      { status: 503 },
    );
  }
}
