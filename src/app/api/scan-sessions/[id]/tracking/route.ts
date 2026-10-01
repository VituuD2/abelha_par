import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { readScanSession, updateSessionOrders, UUID } from "@/lib/scan-session-server";
import { getValidTinyToken } from "@/lib/tiny-auth";
import { resolveAndCacheOlistOrders } from "@/lib/olist-sync";
import { TinyRateLimitError } from "@/lib/olist";
import { hasTrackingCode } from "@/lib/tracking";

export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { access, response: denied } = await authorize();
  if (denied) return denied;
  const user = access.user;
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Sessão inválida" }, { status: 400 });
  try {
    let session = await readScanSession(access.workspaceId, id);
    if (!session || session.status !== "active") return NextResponse.json({ error: "Sessão não disponível." }, { status: 409 });
    const body = await request.json();
    if (!Array.isArray(body.orderIds) || body.orderIds.length > 5 || !body.orderIds.every((orderId: unknown) => typeof orderId === "number" && session!.orders.some(order => order.id === orderId))) return NextResponse.json({ error: "Pedidos inválidos." }, { status: 400 });
    const missing = session.orders.filter(order => body.orderIds.includes(order.id) && order.status === "pending" && !hasTrackingCode(order.trackingCode));
    if (!missing.length) return NextResponse.json({ orders: session.orders });
    const token = await getValidTinyToken(access.workspaceId);
    if (!token.token) return NextResponse.json({ error: token.message || "Conecte a Olist novamente." }, { status: 503 });
    const updates = await resolveAndCacheOlistOrders(access.workspaceId, token.token, missing.map(order => order.id), true);
    if (updates.some(order => order.situacao === 2)) return NextResponse.json({ error: "Um pedido sem rastreio foi cancelado na Olist. Volte à preparação e revise a seleção." }, { status: 409 });
    for (let attempt = 0; attempt < 4; attempt++) {
      session = await readScanSession(access.workspaceId, id);
      if (!session || session.status !== "active") return NextResponse.json({ error: "Sessão encerrada." }, { status: 409 });
      const orders = session.orders.map(order => {
        const update = updates.find(item => item.id === order.id);
        if (!update || update.situacao === null || update.situacao === 2 || order.status !== "pending" || hasTrackingCode(order.trackingCode)) return order;
        return { ...order, trackingCode: update.trackingCode };
      });
      const saved = await updateSessionOrders(access.workspaceId, session, orders, user.id);
      if (saved) return NextResponse.json({ orders: saved.orders });
    }
    return NextResponse.json({ error: "O lote recebeu outra atualização. Tentaremos novamente." }, { status: 409 });
  } catch (error) {
    if (error instanceof TinyRateLimitError) return NextResponse.json({ error: "Limite de consultas Olist.", retryAfterSeconds: error.retryAfterSeconds }, { status: 429 });
    return NextResponse.json({ error: "Não foi possível atualizar os rastreios." }, { status: 503 });
  }
}
