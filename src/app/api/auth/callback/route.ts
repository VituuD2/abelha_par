import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";
import { encryptToken } from "@/lib/token-crypto";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return NextResponse.json({ error: "URL pública não configurada" }, { status: 500 });
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("tiny_oauth_state")?.value;
  const expectedUserId = cookieStore.get("tiny_oauth_user")?.value;
  const verifier = cookieStore.get("tiny_oauth_verifier")?.value;
  const user = await getAuthenticatedUser();
  const clearCookies = (response: NextResponse) => {
    response.cookies.delete("tiny_oauth_state");
    response.cookies.delete("tiny_oauth_user");
    response.cookies.delete("tiny_oauth_verifier");
    return response;
  };

  if (!code || !state || state !== expectedState || !verifier || !user || user.id !== expectedUserId) {
    return clearCookies(NextResponse.redirect(`${appUrl}/?error=OAuthValidationFailed`));
  }

  const clientId = process.env.TINY_CLIENT_ID;
  const clientSecret = process.env.TINY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return clearCookies(NextResponse.redirect(`${appUrl}/?error=ConfigurationError`));

  try {
    const params = new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, code_verifier: verifier, redirect_uri: `${appUrl}/api/auth/callback` });
    const tokenResponse = await fetch("https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params, cache: "no-store" });
    if (!tokenResponse.ok) return clearCookies(NextResponse.redirect(`${appUrl}/?error=TokenExchangeFailed`));

    const data = await tokenResponse.json() as { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in?: number };
    const payload = {
      owner_id: user.id,
      access_token: encryptToken(data.access_token),
      refresh_token: encryptToken(data.refresh_token),
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      refresh_expires_at: data.refresh_expires_in ? new Date(Date.now() + data.refresh_expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await createAdminClient().from("tiny_integrations").upsert(payload, { onConflict: "owner_id" });
    if (error) throw error;
    return clearCookies(NextResponse.redirect(`${appUrl}/?success=TinyConnected`));
  } catch (error) {
    console.error("[auth/callback] token persistence failed", error);
    return clearCookies(NextResponse.redirect(`${appUrl}/?error=CallbackError`));
  }
}
