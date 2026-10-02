import { NextResponse } from "next/server";
import {
  enqueueIncremental,
  processAnalyticsBatch,
} from "@/lib/analytics/sync";
import { refreshDueAnalyticsTokens } from "@/lib/analytics/auth";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (
    !process.env.CRON_SECRET ||
    request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`
  )
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const started = Date.now();
    await refreshDueAnalyticsTokens();
    await enqueueIncremental();
    return NextResponse.json(
      await processAnalyticsBatch(
        undefined,
        Math.max(12000, 45000 - (Date.now() - started)),
      ),
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "Falha no processamento analítico. Confira os checkpoints e a migração v11.",
      },
      { status: 503 },
    );
  }
}
