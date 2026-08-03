import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { fetchOlistOrders } from "@/lib/olist";
import { isRateLimited } from "@/lib/rate-limit";
import { getValidTinyToken } from "@/lib/tiny-auth";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 31;

function isValidRange(dateFrom: string, dateTo: string) {
  if (!ISO_DATE.test(dateFrom) || !ISO_DATE.test(dateTo)) return false;
  const from = new Date(`${dateFrom}T00:00:00.000Z`);
  const to = new Date(`${dateTo}T00:00:00.000Z`);
  return !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to >= from && (to.getTime() - from.getTime()) / 86_400_000 <= MAX_RANGE_DAYS;
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (isRateLimited(`olist:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: "Muitas consultas. Tente novamente em um minuto." }, { status: 429 });
  }

  let body: { dateFrom?: unknown; dateTo?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom : "";
  const dateTo = typeof body.dateTo === "string" && body.dateTo ? body.dateTo : dateFrom;
  if (!isValidRange(dateFrom, dateTo)) {
    return NextResponse.json({ error: "Informe datas válidas com intervalo máximo de 31 dias." }, { status: 400 });
  }

  const tokenResult = await getValidTinyToken(user.id);
  if (!tokenResult.token) {
    return NextResponse.json({ error: tokenResult.message || "Conexão Tiny indisponível.", needsReconnect: tokenResult.status === "expired" }, { status: tokenResult.status === "expired" ? 401 : 503 });
  }

  try {
    const orders = await fetchOlistOrders({ token: tokenResult.token, dateFrom, dateTo });
    return NextResponse.json({ orders, total: orders.length, fetchedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[olist] request failed", error);
    const status = error instanceof Error && error.message.includes("429") ? 429 : 502;
    return NextResponse.json(
      { error: status === 429 ? "A Tiny limitou temporariamente as consultas. Aguarde um minuto e tente novamente." : "Não foi possível buscar os pedidos na Tiny." },
      { status }
    );
  }
}
