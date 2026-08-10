import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";
import { encryptToken } from "@/lib/token-crypto";
import { getRequestOrigin } from "@/lib/app-url";
import { testTinyConnection } from "@/lib/olist";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const appUrl = getRequestOrigin(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const cookieStore = await cookies();
  const expectedState = cookieStore.get("tiny_oauth_state")?.value;
  const expectedUserId = cookieStore.get("tiny_oauth_user")?.value;
  const flowId = cookieStore.get("tiny_oauth_flow")?.value || "missing-flow-cookie";
  const user = await getAuthenticatedUser();
  const clearCookies = (response: NextResponse) => {
    response.cookies.delete("tiny_oauth_state");
    response.cookies.delete("tiny_oauth_user");
    response.cookies.delete("tiny_oauth_flow");
    return response;
  };

  console.info("[tiny-oauth] callback received", {
    flowId,
    requestId: request.headers.get("x-vercel-id") || null,
    hasCode: Boolean(code),
    hasState: Boolean(state),
    stateMatches: Boolean(state && expectedState && state === expectedState),
    hasAppUser: Boolean(user),
    userMatches: Boolean(user && expectedUserId && user.id === expectedUserId),
  });

  if (!code || !state || state !== expectedState || !user || user.id !== expectedUserId) {
    console.warn("[auth/callback] OAuth validation failed", {
      flowId,
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasExpectedState: Boolean(expectedState),
      hasUser: Boolean(user),
      hasExpectedUser: Boolean(expectedUserId),
    });
    return clearCookies(NextResponse.redirect(`${appUrl}/?error=OAuthValidationFailed`));
  }

  const clientId = process.env.TINY_CLIENT_ID;
  const clientSecret = process.env.TINY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return clearCookies(NextResponse.redirect(`${appUrl}/?error=ConfigurationError`));

  try {
    const params = new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: `${appUrl}/api/auth/callback` });
    const tokenResponse = await fetch("https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params, cache: "no-store" });
    if (!tokenResponse.ok) {
      console.error("[tiny-oauth] Tiny token exchange failed", { flowId, status: tokenResponse.status });
      return clearCookies(NextResponse.redirect(`${appUrl}/?error=TokenExchangeFailed`));
    }

    const data = await tokenResponse.json() as { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in?: number };
    const connection = await testTinyConnection(data.access_token);
    if (!connection.ok) {
      console.warn("[tiny-oauth] issued token rejected by orders API", { flowId, status: connection.status });
      return clearCookies(NextResponse.redirect(`${appUrl}/?error=TinyAccessDenied`));
    }

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
    console.info("[tiny-oauth] connection saved", { flowId, requestId: request.headers.get("x-vercel-id") || null });
    return clearCookies(NextResponse.redirect(`${appUrl}/?success=TinyConnected`));
  } catch (error) {
    console.error("[tiny-oauth] token persistence failed", { flowId, error });
    return clearCookies(NextResponse.redirect(`${appUrl}/?error=CallbackError`));
  }
}
