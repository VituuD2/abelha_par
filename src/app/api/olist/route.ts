import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { fetchOlistOrdersPage, TinyApiError, TinyRateLimitError } from "@/lib/olist";
import { isRateLimited } from "@/lib/rate-limit";
import { getValidTinyToken } from "@/lib/tiny-auth";
import { isValidDateRange } from "@/lib/dates";
import { getReconciliationConfig } from "@/lib/reconciliation-config";
import { getNuvemshopConnection } from "@/lib/nuvemshop";
import { cacheOlistOrders } from "@/lib/olist-sync";

export const maxDuration = 60;

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (isRateLimited(`olist:${user.id}`, 30, 60_000)) {
    return NextResponse.json({ error: "Muitas consultas. Tente novamente em um minuto." }, { status: 429 });
  }

  let body: { dateFrom?: unknown; dateTo?: unknown; dateMode?: unknown; cursor?: { day: number; offset: number } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom : "";
  const dateTo = typeof body.dateTo === "string" && body.dateTo ? body.dateTo : dateFrom;
  const dateMode = body.dateMode === "created" ? "created" : body.dateMode === "updated" ? "updated" : null;
  if (!dateMode || !isValidDateRange(dateFrom, dateTo)) {
    return NextResponse.json({ error: "Informe datas válidas com intervalo máximo de 31 dias." }, { status: 400 });
  }
  if (body.cursor && (!Number.isInteger(body.cursor.day) || body.cursor.day < 0 || body.cursor.day > 30 || !Number.isInteger(body.cursor.offset) || body.cursor.offset < 0 || body.cursor.offset > 100_000 || body.cursor.offset % 100 !== 0)) return NextResponse.json({ error: "Página inválida." }, { status: 400 });

  const tokenResult = await getValidTinyToken(user.id);
  if (!tokenResult.token) {
    return NextResponse.json({ error: tokenResult.message || "Conexão Tiny indisponível.", needsReconnect: tokenResult.status === "expired" }, { status: tokenResult.status === "expired" ? 401 : 503 });
  }

  try {
    const connection = await getNuvemshopConnection(user.id);
    const mapping = connection?.mapping || getReconciliationConfig();
    const page = await fetchOlistOrdersPage({ token: tokenResult.token, dateFrom, dateTo, dateMode, ecommerceId: mapping?.ecommerceId, cursor: body.cursor });
    await cacheOlistOrders(user.id, page.orders);
    return NextResponse.json({ ...page, mapping, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[olist] request failed", error);
    if (error instanceof TinyRateLimitError) {
      return NextResponse.json(
        { error: "A Tiny limitou temporariamente as consultas. Aguarde e tente novamente.", retryAfterSeconds: error.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } }
      );
    }
    if (error instanceof TinyApiError && (error.status === 401 || error.status === 403)) {
      return NextResponse.json({ error: "A Olist recusou o acesso aos pedidos. Confira as permissões do aplicativo e da conta no ERP.", needsReconnect: false }, { status: 403 });
    }
    return NextResponse.json({ error: "Não foi possível buscar os pedidos na Tiny." }, { status: 502 });
  }
}
