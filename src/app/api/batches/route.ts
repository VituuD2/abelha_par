import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type IncomingOrder = { id?: unknown; yampiId?: unknown; trackingCode?: unknown; clientName?: unknown; dataCriacao?: unknown; scannedAt?: unknown; status?: unknown };

function sanitizeOrders(value: unknown) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 10_000) return null;
  const orders = value as IncomingOrder[];
  if (orders.some((order) => order.status !== "checked" || typeof order.id !== "number" || typeof order.yampiId !== "string" || typeof order.trackingCode !== "string" || typeof order.clientName !== "string")) return null;
  return orders.map((order) => ({ id: order.id as number, yampiId: (order.yampiId as string).slice(0, 100), trackingCode: (order.trackingCode as string).slice(0, 200), clientName: (order.clientName as string).slice(0, 300), dataCriacao: typeof order.dataCriacao === "string" ? order.dataCriacao.slice(0, 64) : null, scannedAt: typeof order.scannedAt === "string" ? order.scannedAt : null }));
}

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("lotes_bipagem").select("id, numero_lote, data, qtd_pedidos, pedidos, created_at").order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 500 });
  return NextResponse.json({ batches: data });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  let body: { orders?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const orders = sanitizeOrders(body.orders);
  if (!orders) return NextResponse.json({ error: "Lote inválido" }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lotes_bipagem")
    .insert({ owner_id: user.id, data: new Date().toISOString().slice(0, 10), qtd_pedidos: orders.length, pedidos: orders })
    .select("id, numero_lote, data, qtd_pedidos, pedidos, created_at")
    .single();
  if (error) return NextResponse.json({ error: "Não foi possível salvar o lote." }, { status: 500 });
  return NextResponse.json({ ok: true, batch: data }, { status: 201 });
}
