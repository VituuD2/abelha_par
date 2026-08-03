import { createHash, randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const clientId = process.env.TINY_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !appUrl) return NextResponse.json({ error: "OAuth Tiny não configurado" }, { status: 500 });

  const state = crypto.randomUUID();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const redirectUri = `${appUrl}/api/auth/callback`;
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid profile email offline_access", prompt: "login", state, code_challenge: challenge, code_challenge_method: "S256" });
  const response = NextResponse.redirect(`https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth?${params}`);
  response.cookies.set("tiny_oauth_state", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  response.cookies.set("tiny_oauth_user", user.id, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  response.cookies.set("tiny_oauth_verifier", verifier, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}
