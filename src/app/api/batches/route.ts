import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { normalizeResponsible } from "@/lib/responsible";
import { sanitizeOrders } from "@/lib/batch-orders";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const supabase = await createClient();
  const { data, error } = await supabase.from("lotes_bipagem").select("id, numero_lote, responsavel, data, qtd_pedidos, pedidos, created_at").order("created_at", { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: "Não foi possível carregar o histórico." }, { status: 500 });
  return NextResponse.json({ batches: data });
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  let body: { orders?: unknown; responsible?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const orders = sanitizeOrders(body.orders);
  const responsible = normalizeResponsible(body.responsible);
  if (!orders || !responsible) return NextResponse.json({ error: "Lote ou responsável inválido. Todos os pedidos precisam estar bipados e ter código de rastreio." }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lotes_bipagem")
    .insert({ owner_id: user.id, responsavel: responsible, data: new Date().toISOString().slice(0, 10), qtd_pedidos: orders.length, pedidos: orders })
    .select("id, numero_lote, responsavel, data, qtd_pedidos, pedidos, created_at")
    .single();
  if (error) return NextResponse.json({ error: "Não foi possível salvar o lote." }, { status: 500 });
  return NextResponse.json({ ok: true, batch: data }, { status: 201 });
}
