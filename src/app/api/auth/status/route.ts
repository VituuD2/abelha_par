import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { testTinyConnection } from "@/lib/olist";
import { isRateLimited } from "@/lib/rate-limit";
import { getValidTinyToken } from "@/lib/tiny-auth";
import { can } from "@/lib/permissions";
import { operationalHealth } from "@/lib/connection-status";

function connectionResponse(value: { isConnected: boolean; needsReconnect: boolean; status: string; message: string | null }) {
  return NextResponse.json({ ...value, health: operationalHealth(value) }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const requestId = request.headers.get("x-vercel-id") || crypto.randomUUID();
  const { access, response: denied } = await authorize();
  if (denied) return denied;
  const verify = new URL(request.url).searchParams.get("verify") === "1";
  if (verify && !can(access.role, "integrations:manage")) return NextResponse.json({ error: "Diagnóstico disponível somente no Ninho." }, { status: 403, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
  if (isRateLimited(`tiny-status:${access.workspaceId}`, 20, 60_000)) {
    return NextResponse.json({ error: "Muitas verificações. Tente novamente." }, { status: 429 });
  }

  const result = await getValidTinyToken(access.workspaceId);
  if (!result.token) {
    console.warn("[tiny-status] Tiny connection unavailable", { requestId, status: result.status });
    return connectionResponse({ isConnected: false, needsReconnect: result.status === "expired", status: result.status, message: result.message || null });
  }

  // Normal polling checks the stored OAuth lifetime and renews it when needed.
  // The orders API is only contacted by an explicit diagnostic request.
  if (!verify) {
    return connectionResponse({
      isConnected: true,
      needsReconnect: !!result.needsReconnect,
      status: result.status,
      message: result.message || null,
    });
  }
  const connection = await testTinyConnection(result.token, access.workspaceId);
  if (connection.ok) {
    return connectionResponse({
      isConnected: true,
      needsReconnect: !!result.needsReconnect,
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
    return connectionResponse({
      isConnected: false,
      needsReconnect: false,
      status: "access_denied",
      message: "A Olist autenticou a conta, mas negou acesso à API de Pedidos.",
    });
  }
  return connectionResponse({ isConnected: true, needsReconnect: !!result.needsReconnect, status: "valid", message: result.message || "Não foi possível confirmar a API agora." });
}
