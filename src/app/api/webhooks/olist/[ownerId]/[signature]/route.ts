import { NextResponse } from "next/server";
import { enqueueOlistOrders, processWebhookOrderNow, recordWebhook } from "@/lib/olist-sync";
import { extractOlistOrderId, isValidOlistWebhookSignature } from "@/lib/olist-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ownerId: string; signature: string }> }
) {
  const { ownerId, signature } = await params;
  if (!UUID.test(ownerId) || !isValidOlistWebhookSignature(ownerId, signature)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    // Olist can still notify us with an empty payload. The scheduled fallback
    // will discover the update by dataAtualizacao.
  }

  try {
    await recordWebhook(ownerId);
    const orderId = extractOlistOrderId(payload);
    if (orderId) {
      await enqueueOlistOrders(ownerId, [orderId], true);
      await processWebhookOrderNow(ownerId, orderId);
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    // Returning non-200 makes Olist retry the notification. The operation is
    // idempotent because the queue has a unique owner/order constraint.
    return NextResponse.json({ error: "Não foi possível registrar o webhook." }, { status: 500 });
  }
}
