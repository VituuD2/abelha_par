import { createClient } from "@/lib/supabase/server";

const TINY_TOKEN_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

/**
 * Result of a token validation/refresh attempt.
 * - "valid": token is still valid, no refresh needed
 * - "refreshed": token was expired and successfully refreshed
 * - "expired": refresh token is expired/revoked, user must re-authenticate
 * - "error": temporary error (network, etc.) — can retry later
 */
export type TokenStatus = "valid" | "refreshed" | "expired" | "error";

export interface TokenResult {
  token: string | null;
  status: TokenStatus;
  message?: string;
}

/**
 * Gets a valid Tiny ERP access token.
 * 
 * Flow:
 * 1. Check if integration record exists
 * 2. Check if refresh token itself is expired → delete record, return "expired"
 * 3. If access token still valid → return it
 * 4. If access token expired → try refresh
 *    4a. Refresh succeeds → save new tokens (including rotated refresh_token), return new access token
 *    4b. Refresh fails with 400/401 → refresh token revoked, delete record, return "expired"
 *    4c. Refresh fails with other error → return "error" (temporary)
 */
export async function getValidTinyToken(): Promise<TokenResult> {
  const supabase = await createClient();

  // 1. Fetch the integration record
  const { data: integration, error } = await supabase
    .from("tiny_integrations")
    .select("*")
    .limit(1)
    .single();

  if (error || !integration) {
    return { token: null, status: "expired", message: "Nenhuma conexão encontrada. Conecte sua conta Tiny ERP." };
  }

  // 2. Check if the refresh token itself has expired
  if (integration.refresh_expires_at) {
    const refreshExpiresAt = new Date(integration.refresh_expires_at).getTime();
    const now = Date.now();

    if (now >= refreshExpiresAt) {
      console.warn("[tiny-auth] Refresh token expired. Deleting stale integration record.");
      await deleteIntegration(supabase, integration.id);
      return {
        token: null,
        status: "expired",
        message: "Sessão expirada. Por favor, reconecte sua conta Tiny ERP.",
      };
    }
  }

  // 3. Check if access token is still valid (with 5-minute buffer)
  const expiresAt = new Date(integration.expires_at).getTime();
  const now = Date.now();
  const timeRemaining = expiresAt - now;

  if (timeRemaining >= 300_000) {
    // Access token still valid
    return { token: integration.access_token, status: "valid" };
  }

  // 4. Access token expired or about to expire — try refresh
  return await refreshToken(supabase, integration);
}

/**
 * Attempts to refresh the access token using the refresh token.
 */
async function refreshToken(
  supabase: Awaited<ReturnType<typeof createClient>>,
  integration: {
    id: string;
    refresh_token: string;
    [key: string]: unknown;
  }
): Promise<TokenResult> {
  const clientId = process.env.TINY_CLIENT_ID;
  const clientSecret = process.env.TINY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[tiny-auth] Missing TINY_CLIENT_ID or TINY_CLIENT_SECRET in environment");
    return {
      token: null,
      status: "error",
      message: "Credenciais OAuth não configuradas no servidor.",
    };
  }

  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", integration.refresh_token);
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);

  try {
    const response = await fetch(TINY_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    // Refresh token revoked or invalid — user must re-authenticate
    if (response.status === 400 || response.status === 401) {
      const errorText = await response.text();
      console.warn(`[tiny-auth] Refresh token rejected (${response.status}): ${errorText}`);
      await deleteIntegration(supabase, integration.id);
      return {
        token: null,
        status: "expired",
        message: "Token de acesso revogado pelo Tiny ERP. Por favor, reconecte sua conta.",
      };
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[tiny-auth] Unexpected refresh error (${response.status}): ${errorText}`);
      return {
        token: null,
        status: "error",
        message: `Erro temporário ao renovar token (${response.status}). Tente novamente.`,
      };
    }

    const data = await response.json();

    // Calculate expiration times
    const newAccessExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
    
    // Keycloak returns refresh_expires_in for the new refresh token's lifetime
    const newRefreshExpiresAt = data.refresh_expires_in
      ? new Date(Date.now() + data.refresh_expires_in * 1000).toISOString()
      : null;

    // Save new tokens — Keycloak does token rotation, so we MUST save the new refresh_token
    const updatePayload: Record<string, unknown> = {
      access_token: data.access_token,
      refresh_token: data.refresh_token, // New rotated refresh token!
      expires_at: newAccessExpiresAt,
      updated_at: new Date().toISOString(),
    };

    if (newRefreshExpiresAt) {
      updatePayload.refresh_expires_at = newRefreshExpiresAt;
    }

    const { error: updateError } = await supabase
      .from("tiny_integrations")
      .update(updatePayload)
      .eq("id", integration.id);

    if (updateError) {
      console.error("[tiny-auth] Failed to save refreshed tokens to database:", updateError);
      // Still return the token since it's valid — it just won't be persisted
      return {
        token: data.access_token,
        status: "refreshed",
        message: "Token renovado mas houve erro ao salvar. Pode expirar na próxima request.",
      };
    }

    console.log("[tiny-auth] Token refreshed successfully. New refresh token saved.");
    return { token: data.access_token, status: "refreshed" };

  } catch (err) {
    console.error("[tiny-auth] Network error during token refresh:", err);
    return {
      token: null,
      status: "error",
      message: "Erro de conexão ao renovar token. Verifique sua internet.",
    };
  }
}

/**
 * Deletes a stale/invalid integration record from the database.
 */
async function deleteIntegration(
  supabase: Awaited<ReturnType<typeof createClient>>,
  integrationId: string
): Promise<void> {
  const { error } = await supabase
    .from("tiny_integrations")
    .delete()
    .eq("id", integrationId);

  if (error) {
    console.error("[tiny-auth] Failed to delete stale integration:", error);
  } else {
    console.log("[tiny-auth] Stale integration record deleted.");
  }
}
