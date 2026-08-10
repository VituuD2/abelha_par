import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { testTinyConnection } from "@/lib/olist";
import { isRateLimited } from "@/lib/rate-limit";
import { getValidTinyToken } from "@/lib/tiny-auth";
import { getAppUrl } from "@/lib/app-url";
import { getOlistWebhookUrl } from "@/lib/olist-webhook";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (isRateLimited(`tiny-status:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "Muitas verificações. Tente novamente." }, { status: 429 });
  }

  const result = await getValidTinyToken(user.id);
  if (!result.token) {
    return NextResponse.json({ isConnected: false, needsReconnect: result.status === "expired", status: result.status, message: result.message || null });
  }

  const connection = await testTinyConnection(result.token);
  if (connection.ok) {
    return NextResponse.json({
      isConnected: true,
      needsReconnect: false,
      status: result.status,
      message: null,
      webhookUrl: getOlistWebhookUrl(getAppUrl(request), user.id),
    });
  }
  if (connection.status === 401 || connection.status === 403) {
    return NextResponse.json({ isConnected: false, needsReconnect: true, status: "expired", message: "Token Tiny inválido. Reconecte a conta." });
  }
  return NextResponse.json({ isConnected: true, needsReconnect: false, status: "valid", message: "Não foi possível confirmar a API agora." });
}
