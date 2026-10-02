import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { readScanSession, submitSessionScan, ScanSubmissionError, UUID } from "@/lib/scan-session-server";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Context) {
  const { access, response: denied } = await authorize();
  if (denied) return denied;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Sessão inválida" }, { status: 400 });
  try {
    const session = await readScanSession(access.workspaceId, id);
    return NextResponse.json(session ? { session } : { error: "Sessão não encontrada." }, { status: session ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Não foi possível recuperar a conferência." }, { status: 503 }); }
}

export async function POST(request: Request, { params }: Context) {
  const started = performance.now();
  const { access, response: denied } = await authorize();
  if (denied) return denied;
  const authorized = performance.now();
  const user = access.user;
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Sessão inválida" }, { status: 400 });
  try {
    const body = await request.json();
    if (!body || typeof body.code !== "string" || !body.code.trim() || body.code.length > 200) return NextResponse.json({ error: "Código inválido." }, { status: 400 });
    const revision = Number.isSafeInteger(body.revision) && body.revision >= 0 && body.revision <= 2_147_483_647 ? body.revision : null;
    const saving = performance.now();
    const { payload, mode } = await submitSessionScan(access.workspaceId, id, user.id, body.code, revision);
    return NextResponse.json(payload, { headers: {
      "Cache-Control": "no-store",
      "Server-Timing": `authorize;dur=${(authorized - started).toFixed(1)}, save;dur=${(performance.now() - saving).toFixed(1)};desc="${mode}"`,
    } });
  } catch (error) { return NextResponse.json({ error: error instanceof ScanSubmissionError ? error.message : error instanceof SyntaxError ? "JSON inválido" : "Não foi possível confirmar a leitura. Tente novamente; uma leitura já gravada não será duplicada." }, { status: error instanceof ScanSubmissionError ? error.status : error instanceof SyntaxError ? 400 : 503 }); }
}
