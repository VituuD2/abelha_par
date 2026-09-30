import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { readScanSession, updateSessionOrders, UUID } from "@/lib/scan-session-server";
import { applyScan } from "@/lib/scan-session";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Sessão inválida" }, { status: 400 });
  try {
    const session = await readScanSession(user.id, id);
    return NextResponse.json(session ? { session } : { error: "Sessão não encontrada." }, { status: session ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Não foi possível recuperar a conferência." }, { status: 503 }); }
}

export async function POST(request: Request, { params }: Context) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Sessão inválida" }, { status: 400 });
  try {
    const body = await request.json();
    if (typeof body.code !== "string" || !body.code.trim() || body.code.length > 200) return NextResponse.json({ error: "Código inválido." }, { status: 400 });
    for (let attempt = 0; attempt < 4; attempt++) {
      const session = await readScanSession(user.id, id);
      if (!session) return NextResponse.json({ error: "Sessão não encontrada." }, { status: 404 });
      if (session.status !== "active") return NextResponse.json({ error: "Este lote já foi finalizado." }, { status: 409 });
      const { orders, result } = applyScan(session.orders, body.code);
      if (result.type === "error") return NextResponse.json({ session, result });
      const saved = await updateSessionOrders(user.id, session, orders);
      if (saved) return NextResponse.json({ session: saved, result });
    }
    return NextResponse.json({ error: "Outra leitura está sendo gravada. Tente novamente." }, { status: 409 });
  } catch (error) { return NextResponse.json({ error: error instanceof SyntaxError ? "JSON inválido" : "Não foi possível confirmar a leitura. Tente novamente; uma leitura já gravada não será duplicada." }, { status: error instanceof SyntaxError ? 400 : 503 }); }
}
