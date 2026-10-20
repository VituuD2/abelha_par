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
    const renewal = await refreshDueAnalyticsTokens()
      .catch(() => ({ checked: 0, reconnect: 0, failed: 1 }));
    // Existing durable jobs can progress even if scheduling or proactive renewal is unavailable.
    const scheduling = await enqueueIncremental().then(() => ({ ok: true, error: null }))
      .catch(() => ({ ok: false, error: "Agendamento incremental indisponível; nova tentativa no próximo ciclo." }));
    const costs = Date.now() - started < 15000
      ? await (async () => {
          const history = await processCostHistorySync();
          return history.claimed ? history : processCostSync();
        })().catch(() => ({ processed: 0, error: "Falha na atualização do CMV; retomada automática no próximo ciclo." }))
      : { processed: 0, pending: true };
    const budget = 45000 - (Date.now() - started);
    if (budget < 15000)
      return NextResponse.json({ processed: 0, pending: true, renewal, costs, scheduling }, { status: renewal.reconnect || renewal.failed || costs.error || !scheduling.ok ? 503 : 200 });
    const result = await processAnalyticsBatches(undefined, budget);
    return NextResponse.json(
      { ...result, renewal, costs, scheduling, elapsedMs: Date.now() - started, ...(renewal.reconnect ? { guidance: "Reconecte a conta indicada no Ninho para retomar seu checkpoint." } : {}) },
      { status: result.error || renewal.reconnect || renewal.failed || costs.error || !scheduling.ok ? 503 : 200 },
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
