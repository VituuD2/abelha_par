import { NextResponse } from "next/server";
import {
  enqueueIncremental,
  processAnalyticsBatches,
  processAnalyticsWebhookBatches,
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
    const webhooks = await processAnalyticsWebhookBatches(undefined, Math.min(20000, 45000 - (Date.now() - started)))
      .catch(() => ({ processed: 0, pending: true, error: "Fila de webhooks indisponível; nova tentativa no próximo ciclo." }));
    // Existing durable jobs can progress even if scheduling or proactive renewal is unavailable.
    const scheduling = await enqueueIncremental().then(() => ({ ok: true, error: null }))
      .catch(() => ({ ok: false, error: "Agendamento incremental indisponível; nova tentativa no próximo ciclo." }));
    // Reserve two out of three cycles for sales on the cost-provider account.
    const costTurn = Math.floor(started / 60000) % 3 === 0;
    const costs = costTurn && Date.now() - started < 15000
      ? await (async () => {
          const history = await processCostHistorySync();
          return history.claimed ? history : processCostSync();
        })().catch(() => ({ processed: 0, error: "Falha na atualização do CMV; retomada automática no próximo ciclo." }))
      : { processed: 0, pending: true };
    const budget = 45000 - (Date.now() - started);
    if (budget < 15000)
      return NextResponse.json({ processed: webhooks.processed, pending: true, webhooks, renewal, costs, scheduling }, { status: webhooks.error || renewal.reconnect || renewal.failed || costs.error || !scheduling.ok ? 503 : 200 });
    const result = await processAnalyticsBatches(undefined, budget);
    return NextResponse.json(
      { ...result, processed: result.processed + webhooks.processed, pending: result.pending || webhooks.pending, webhooks, renewal, costs, scheduling, elapsedMs: Date.now() - started, ...(renewal.reconnect ? { guidance: "Reconecte a conta indicada no Ninho para retomar seu checkpoint." } : {}) },
      { status: webhooks.error || result.error || renewal.reconnect || renewal.failed || costs.error || !scheduling.ok ? 503 : 200 },
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
