import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getRequestOrigin } from "@/lib/app-url";
import { createTinyOAuthState } from "@/lib/tiny-oauth-state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", "/");
    return NextResponse.redirect(url);
  }

  const clientId = process.env.TINY_CLIENT_ID;
  if (!clientId) return NextResponse.json({ error: "TINY_CLIENT_ID não configurado" }, { status: 500 });

  const { state, flowId } = createTinyOAuthState(user.id);
  const appUrl = getRequestOrigin(request);
  const redirectUri = `${appUrl}/api/auth/callback`;
  // Parameters follow the Tiny/Olist confidential-client OAuth documentation.
  // `state` is retained as an anti-CSRF value and is ignored by the provider flow.
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
    state,
    // Do not silently reuse a Tiny SSO session. On reconnection, the operator
    // must be able to authenticate with the ERP user that has API access.
    prompt: "login",
  });
  const response = NextResponse.redirect(`https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth?${params}`);
  // Remove cookies used by previous versions of this flow. The signed state is
  // now self-contained and bound to the authenticated application user.
  for (const path of ["/", "/api/auth"]) {
    response.cookies.set("tiny_oauth_state", "", { path, maxAge: 0 });
    response.cookies.set("tiny_oauth_user", "", { path, maxAge: 0 });
    response.cookies.set("tiny_oauth_flow", "", { path, maxAge: 0 });
  }
  console.info("[tiny-oauth] authorization started", {
    flowId,
    origin: appUrl,
    requestId: request.headers.get("x-vercel-id") || null,
  });
  return response;
}
