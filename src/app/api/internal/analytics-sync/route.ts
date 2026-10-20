import { NextResponse } from "next/server";
import {
  enqueueIncremental,
  processAnalyticsBatches,
} from "@/lib/analytics/sync";
import { refreshDueAnalyticsTokens } from "@/lib/analytics/auth";
import { processCostSync } from "@/lib/analytics/cost-sync";
import { processCostHistorySync } from "@/lib/analytics/cost-history-sync";
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
    const costs = Date.now() - started < 15000
      ? await (async () => {
          const history = await processCostHistorySync();
          return history.claimed ? history : processCostSync();
        })().catch(() => ({ processed: 0, error: "Falha na atualização do CMV; retomada automática no próximo ciclo." }))
      : { processed: 0, pending: true };
    const budget = 45000 - (Date.now() - started);
    if (budget < 15000)
      return NextResponse.json({ processed: 0, pending: true, renewal, costs }, { status: renewal.reconnect || renewal.failed || costs.error ? 503 : 200 });
    const result = await processAnalyticsBatches(undefined, budget);
    return NextResponse.json(
      { ...result, renewal, costs, ...(renewal.reconnect ? { guidance: "Reconecte a conta indicada no Ninho para retomar seu checkpoint." } : {}) },
      { status: result.error || renewal.reconnect || renewal.failed || costs.error ? 503 : 200 },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Falha no processamento analítico. Confira os checkpoints e a migração v13.",
      },
      { status: 503 },
    );
  }
}
