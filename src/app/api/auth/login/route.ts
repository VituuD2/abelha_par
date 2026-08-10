import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { getRequestOrigin } from "@/lib/app-url";

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

  const state = crypto.randomUUID();
  const flowId = crypto.randomUUID();
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
  response.cookies.set("tiny_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  response.cookies.set("tiny_oauth_user", user.id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  response.cookies.set("tiny_oauth_flow", flowId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  console.info("[tiny-oauth] authorization started", {
    flowId,
    origin: appUrl,
    requestId: request.headers.get("x-vercel-id") || null,
  });
  return response;
}
