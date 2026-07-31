import { createClient } from "@/lib/supabase/server";

const TINY_TOKEN_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

export async function getValidTinyToken(): Promise<string | null> {
  const supabase = await createClient();

  // Fetch the first (and theoretically only) integration record
  const { data: integration, error } = await supabase
    .from("tiny_integrations")
    .select("*")
    .limit(1)
    .single();

  if (error || !integration) {
    return null; // No connection established
  }

  const expiresAt = new Date(integration.expires_at).getTime();
  const now = Date.now();
  const timeRemaining = expiresAt - now;

  // If the token expires in less than 5 minutes (300,000 ms), refresh it
  if (timeRemaining < 300000) {
    try {
      const clientId = process.env.TINY_CLIENT_ID;
      const clientSecret = process.env.TINY_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error("Missing Tiny ERP OAuth credentials in environment");
      }

      const params = new URLSearchParams();
      params.append("grant_type", "refresh_token");
      params.append("refresh_token", integration.refresh_token);
      params.append("client_id", clientId);
      params.append("client_secret", clientSecret);

      const response = await fetch(TINY_TOKEN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to refresh token: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      
      const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

      const { error: updateError } = await supabase
        .from("tiny_integrations")
        .update({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: newExpiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", integration.id);

      if (updateError) {
        throw updateError;
      }

      return data.access_token;
    } catch (err) {
      console.error("Error refreshing Tiny ERP token:", err);
      // Could consider deleting the invalid token record here if refresh fails permanently
      return null;
    }
  }

  // Token is still valid
  return integration.access_token;
}
