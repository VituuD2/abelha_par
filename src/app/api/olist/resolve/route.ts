import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { TinyApiError, TinyRateLimitError } from "@/lib/olist";
import { isRateLimited } from "@/lib/rate-limit";
import { getValidTinyToken } from "@/lib/tiny-auth";
import { resolveAndCacheOlistOrders } from "@/lib/olist-sync";

// Keeping each server request short avoids Vercel function timeouts while the
// Tiny API detail endpoint is throttled deliberately.
const MAX_BATCH_SIZE = 5;

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (isRateLimited(`olist-resolve:${user.id}`, 30, 60_000)) return NextResponse.json({ error: "Muitas consultas. Aguarde um minuto." }, { status: 429 });

  let body: { orderIds?: unknown; forceRefresh?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (!Array.isArray(body.orderIds) || body.orderIds.length === 0 || body.orderIds.length > MAX_BATCH_SIZE || body.orderIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    return NextResponse.json({ error: `Informe entre 1 e ${MAX_BATCH_SIZE} IDs de pedido válidos.` }, { status: 400 });
  }

  const token = await getValidTinyToken(user.id);
  if (!token.token) return NextResponse.json({ error: token.message || "Conexão Tiny indisponível.", needsReconnect: token.status === "expired" }, { status: token.status === "expired" ? 401 : 503 });

  try {
    const orders = await resolveAndCacheOlistOrders(
      user.id,
      token.token,
      body.orderIds as number[],
      body.forceRefresh === true
    );
    return NextResponse.json({ orders });
  } catch (error) {
    console.error("[olist/resolve] request failed", error);
    if (error instanceof TinyRateLimitError) {
      return NextResponse.json(
        { error: "A Tiny limitou temporariamente as consultas.", retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } }
      );
    }
    if (error instanceof TinyApiError) {
      console.warn("[olist/resolve] Tiny detail request rejected", {
        orderId: error.orderId,
        status: error.status,
        providerMessage: error.providerMessage,
        providerRequestId: error.providerRequestId,
      });
      const requestId = error.providerRequestId ? { providerRequestId: error.providerRequestId } : {};
      if (error.status === 401) {
        return NextResponse.json(
          { error: "A Olist não autorizou a leitura dos detalhes dos pedidos. Reconecte a conta e tente novamente.", needsReconnect: true, ...requestId },
          { status: 401 }
        );
      }
      if (error.status === 403) {
        return NextResponse.json(
          { error: "A conta conectada não tem permissão para consultar os detalhes dos pedidos na Olist.", ...requestId },
          { status: 403 }
        );
      }
      if (error.status === 404) {
        return NextResponse.json(
          { error: `O pedido ${error.orderId || "solicitado"} não está mais disponível para consulta na Olist.`, ...requestId },
          { status: 422 }
        );
      }
      if (error.status >= 500) {
        return NextResponse.json(
          { error: "A Olist está temporariamente indisponível para consultar detalhes. Aguarde um instante e tente novamente.", ...requestId },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: "A Olist recusou a consulta dos detalhes de um pedido. Tente buscar os pedidos novamente.", ...requestId },
        { status: 502 }
      );
    }
    return NextResponse.json({ error: "Não foi possível resolver os detalhes dos pedidos." }, { status: 502 });
  }
}
