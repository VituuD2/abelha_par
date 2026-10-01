import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { testTinyConnection } from "@/lib/olist";
import { isRateLimited } from "@/lib/rate-limit";
import { getValidTinyToken } from "@/lib/tiny-auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const requestId = request.headers.get("x-vercel-id") || crypto.randomUUID();
  const { access, response: denied } = await authorize();
  if (denied) return denied;
  const verify = new URL(request.url).searchParams.get("verify") === "1";
  if (verify && access.role !== "admin") return NextResponse.json({ error: "Diagnóstico disponível somente no Ninho." }, { status: 403 });
  if (isRateLimited(`tiny-status:${access.workspaceId}`, 20, 60_000)) {
    return NextResponse.json({ error: "Muitas verificações. Tente novamente." }, { status: 429 });
  }

  const result = await getValidTinyToken(access.workspaceId);
  if (!result.token) {
    console.warn("[tiny-status] Tiny connection unavailable", { requestId, status: result.status });
    return NextResponse.json({ isConnected: false, needsReconnect: result.status === "expired", status: result.status, message: result.message || null });
  }

  // Normal polling checks the stored OAuth lifetime and renews it when needed.
  // The orders API is only contacted by an explicit diagnostic request.
  if (!verify) {
    return NextResponse.json({
      isConnected: true,
      needsReconnect: false,
      status: result.status,
      message: result.message || null,
    });
  }
  const connection = await testTinyConnection(result.token);
  if (connection.ok) {
    return NextResponse.json({
      isConnected: true,
      needsReconnect: false,
      status: result.status,
      message: null,
    });
  }
  if (connection.status === 401 || connection.status === 403) {
    console.warn("[tiny-status] Olist denied orders access", {
      requestId,
      status: connection.status,
      providerMessage: connection.providerMessage,
      providerRequestId: connection.providerRequestId,
      wwwAuthenticate: connection.wwwAuthenticate,
    });
    // OAuth can issue an unexpired token that is denied by the Pedidos
    // resource. Treating this as a local expiration causes a reconnect loop.
    return NextResponse.json({
      isConnected: false,
      needsReconnect: false,
      status: "access_denied",
      message: "A Olist autenticou a conta, mas negou acesso à API de Pedidos.",
    });
  }
  return NextResponse.json({ isConnected: true, needsReconnect: false, status: "valid", message: "Não foi possível confirmar a API agora." });
}
