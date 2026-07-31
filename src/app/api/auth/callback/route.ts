import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://abelha-par.vercel.app";
  const redirectUri = `${appUrl}/api/auth/callback`;

  if (!code) {
    return NextResponse.redirect(`${appUrl}/?error=NoCodeProvided`);
  }

  const clientId = process.env.TINY_CLIENT_ID;
  const clientSecret = process.env.TINY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Missing Tiny ERP OAuth credentials");
    return NextResponse.redirect(`${appUrl}/?error=ConfigurationError`);
  }

  try {
    const params = new URLSearchParams();
    params.append("grant_type", "authorization_code");
    params.append("code", code);
    params.append("client_id", clientId);
    params.append("client_secret", clientSecret);
    params.append("redirect_uri", redirectUri);

    const tokenResponse = await fetch(
      "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      }
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error("Failed to exchange token:", tokenResponse.status, errorText);
      return NextResponse.redirect(`${appUrl}/?error=TokenExchangeFailed`);
    }

    const data = await tokenResponse.json();
    const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

    const supabase = await createClient();

    // Upsert behavior: To keep it single-tenant for now, we'll try to find an existing record.
    // If it exists, update it. If not, insert it.
    const { data: existing } = await supabase
      .from("tiny_integrations")
      .select("id")
      .limit(1)
      .single();

    if (existing) {
      await supabase
        .from("tiny_integrations")
        .update({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabase
        .from("tiny_integrations")
        .insert({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: expiresAt,
        });
    }

    return NextResponse.redirect(`${appUrl}/?success=TinyConnected`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    return NextResponse.redirect(`${appUrl}/?error=CallbackError`);
  }
}
