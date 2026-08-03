import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { resolveOlistOrders, TinyRateLimitError } from "@/lib/olist";
import { isRateLimited } from "@/lib/rate-limit";
import { getValidTinyToken } from "@/lib/tiny-auth";

const MAX_BATCH_SIZE = 10;

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (isRateLimited(`olist-resolve:${user.id}`, 30, 60_000)) return NextResponse.json({ error: "Muitas consultas. Aguarde um minuto." }, { status: 429 });

  let body: { orderIds?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0 || body.orderIds.length > MAX_BATCH_SIZE || body.orderIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    return NextResponse.json({ error: `Informe entre 1 e ${MAX_BATCH_SIZE} IDs de pedido válidos.` }, { status: 400 });
  }

  const token = await getValidTinyToken(user.id);
  if (!token.token) return NextResponse.json({ error: token.message || "Conexão Tiny indisponível.", needsReconnect: token.status === "expired" }, { status: token.status === "expired" ? 401 : 503 });

  try {
    const orders = await resolveOlistOrders(token.token, body.orderIds as number[]);
    return NextResponse.json({ orders });
  } catch (error) {
    console.error("[olist/resolve] request failed", error);
    if (error instanceof TinyRateLimitError) {
      return NextResponse.json(
        { error: "A Tiny limitou temporariamente as consultas.", retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } }
      );
    }
    return NextResponse.json({ error: "Não foi possível resolver os detalhes dos pedidos." }, { status: 502 });
  }
}
