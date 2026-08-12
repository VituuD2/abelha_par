import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth";
import { encryptToken } from "@/lib/token-crypto";
import { getRequestOrigin } from "@/lib/app-url";
import { verifyTinyOAuthState } from "@/lib/tiny-oauth-state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const appUrl = getRequestOrigin(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const providerError = searchParams.get("error");
  const user = await getAuthenticatedUser();
  const verifiedState = state && user ? verifyTinyOAuthState(state, user.id) : null;
  const flowId = verifiedState?.flowId || "invalid-flow";

  console.info("[tiny-oauth] callback received", {
    flowId,
    requestId: request.headers.get("x-vercel-id") || null,
    hasCode: Boolean(code),
    hasState: Boolean(state),
    stateValid: Boolean(verifiedState),
    hasAppUser: Boolean(user),
  });

  if (!user || !verifiedState) {
    console.warn("[auth/callback] OAuth validation failed", {
      flowId,
      hasCode: Boolean(code),
      hasState: Boolean(state),
      hasUser: Boolean(user),
    });
    return NextResponse.redirect(`${appUrl}/?error=OAuthValidationFailed`);
  }
  if (providerError) {
    console.warn("[tiny-oauth] provider denied authorization", { flowId, providerError });
    return NextResponse.redirect(`${appUrl}/?error=OAuthProviderDenied`);
  }
  if (!code) {
    return NextResponse.redirect(`${appUrl}/?error=OAuthCodeMissing`);
  }

  const clientId = process.env.TINY_CLIENT_ID;
  const clientSecret = process.env.TINY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return NextResponse.redirect(`${appUrl}/?error=ConfigurationError`);

  try {
    const params = new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, client_secret: clientSecret, redirect_uri: `${appUrl}/api/auth/callback` });
    const tokenResponse = await fetch("https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params, cache: "no-store" });
    if (!tokenResponse.ok) {
      console.error("[tiny-oauth] Tiny token exchange failed", { flowId, status: tokenResponse.status });
      return NextResponse.redirect(`${appUrl}/?error=TokenExchangeFailed`);
    }

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
    console.info("[tiny-oauth] connection saved", { flowId, requestId: request.headers.get("x-vercel-id") || null });
    return NextResponse.redirect(`${appUrl}/?success=TinyConnected`);
  } catch (error) {
    console.error("[tiny-oauth] token persistence failed", { flowId, error });
    return NextResponse.redirect(`${appUrl}/?error=CallbackError`);
  }
}
