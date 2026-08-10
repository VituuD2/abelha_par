import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { testTinyConnection } from "@/lib/olist";
import { isRateLimited } from "@/lib/rate-limit";
import { getValidTinyToken } from "@/lib/tiny-auth";
import { getAppUrl } from "@/lib/app-url";
import { getOlistWebhookUrl } from "@/lib/olist-webhook";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function hasSupabaseSessionCookie(request: Request) {
  return /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.\d+)?=/.test(request.headers.get("cookie") || "");
}

export async function GET(request: Request) {
  const requestId = request.headers.get("x-vercel-id") || crypto.randomUUID();
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (!user) {
    console.warn("[tiny-status] application session unavailable", {
      requestId,
      hasSupabaseSessionCookie: hasSupabaseSessionCookie(request),
      authError: authError?.message || null,
    });
  }
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (isRateLimited(`tiny-status:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: "Muitas verificações. Tente novamente." }, { status: 429 });
  }

  const result = await getValidTinyToken(user.id);
  if (!result.token) {
    console.warn("[tiny-status] Tiny connection unavailable", { requestId, status: result.status });
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
    console.warn("[tiny-status] Tiny token rejected", {
      requestId,
      status: connection.status,
      providerMessage: connection.providerMessage,
    });
    return NextResponse.json({ isConnected: false, needsReconnect: true, status: "expired", message: "Token Tiny inválido. Reconecte a conta." });
  }
  return NextResponse.json({ isConnected: true, needsReconnect: false, status: "valid", message: "Não foi possível confirmar a API agora." });
}
