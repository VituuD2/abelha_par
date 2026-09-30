import { NextResponse } from "next/server";
import { discoverCurrentUpdatesForAllIntegrations, processQueuedOlistOrders } from "@/lib/olist-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const discovered = await discoverCurrentUpdatesForAllIntegrations();
    const recovered = await processQueuedOlistOrders();
    return NextResponse.json({
      ok: true,
      discovered,
      claimed: recovered.claimed,
      completed: recovered.completed,
    });
  } catch (error) {
    console.error("[olist-sync] cron failed", error);
    return NextResponse.json({ error: "Falha na sincronização incremental." }, { status: 500 });
  }
}
