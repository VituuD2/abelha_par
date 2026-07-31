import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const clientId = process.env.TINY_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://abelha-par.vercel.app";

  if (!clientId) {
    return NextResponse.json(
      { error: "TINY_CLIENT_ID não configurado" },
      { status: 500 }
    );
  }

  const redirectUri = `${appUrl}/api/auth/callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid",
  });

  const tinyAuthUrl = `https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth?${params.toString()}`;

  // Redirect the user to Tiny ERP login
  return NextResponse.redirect(tinyAuthUrl);
}
