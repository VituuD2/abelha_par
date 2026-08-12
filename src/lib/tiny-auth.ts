import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/token-crypto";

const TINY_TOKEN_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

export type TokenStatus = "valid" | "refreshed" | "expired" | "error";
export interface TokenResult { token: string | null; status: TokenStatus; message?: string }

interface Integration {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string | null;
}

export async function getValidTinyToken(userId: string): Promise<TokenResult> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("tiny_integrations")
    .select("id, access_token, refresh_token, expires_at, refresh_expires_at")
    .eq("owner_id", userId)
    .maybeSingle();

  if (error || !data) {
    return { token: null, status: "expired", message: "Nenhuma conexão Tiny encontrada." };
  }

  const integration = data as Integration;
  const now = Date.now();
  if (integration.refresh_expires_at && now >= new Date(integration.refresh_expires_at).getTime()) {
    await supabase.from("tiny_integrations").delete().eq("id", integration.id).eq("owner_id", userId);
    return { token: null, status: "expired", message: "Sessão Tiny expirada. Reconecte a conta." };
  }

  try {
    const accessToken = decryptToken(integration.access_token);
    if (new Date(integration.expires_at).getTime() - now >= 300_000) {
      return { token: accessToken, status: "valid" };
    }
    return refreshToken(userId, integration, decryptToken(integration.refresh_token));
  } catch {
    // Plaintext/invalid legacy entries are never reused after the security migration.
    await supabase.from("tiny_integrations").delete().eq("id", integration.id).eq("owner_id", userId);
    return { token: null, status: "expired", message: "A conexão Tiny deve ser refeita com segurança." };
  }
}

async function refreshToken(userId: string, integration: Integration, refreshToken: string): Promise<TokenResult> {
  const clientId = process.env.TINY_CLIENT_ID;
  const clientSecret = process.env.TINY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return { token: null, status: "error", message: "Credenciais Tiny ausentes no servidor." };
  }

  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  try {
    const response = await fetch(TINY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      cache: "no-store",
    });

    if (response.status === 400 || response.status === 401) {
      // Refresh tokens are rotated by the authorization server. Two requests
      // that arrive together can therefore use the same old refresh token:
      // one succeeds and saves the new pair while the other is rejected. Do
      // not delete the integration from the losing request, or it can erase a
      // connection that was just renewed by the winning one.
      await new Promise((resolve) => setTimeout(resolve, 250));
      const { data: current } = await createAdminClient()
        .from("tiny_integrations")
        .select("id, access_token, refresh_token, expires_at, refresh_expires_at")
        .eq("id", integration.id)
        .eq("owner_id", userId)
        .maybeSingle();
      if (current && current.refresh_token !== integration.refresh_token) {
        return getValidTinyToken(userId);
      }
      return { token: null, status: "expired", message: "A autorização Tiny expirou ou foi revogada. Reconecte a conta." };
    }
    if (!response.ok) return { token: null, status: "error", message: "Não foi possível renovar a conexão Tiny." };

    const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number; refresh_expires_in?: number };
    const payload = {
      access_token: encryptToken(data.access_token),
      refresh_token: encryptToken(data.refresh_token),
      expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
      refresh_expires_at: data.refresh_expires_in ? new Date(Date.now() + data.refresh_expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await createAdminClient().from("tiny_integrations").update(payload).eq("id", integration.id).eq("owner_id", userId);
    if (error) return { token: null, status: "error", message: "Token renovado, mas não foi possível salvá-lo com segurança." };
    return { token: data.access_token, status: "refreshed" };
  } catch {
    return { token: null, status: "error", message: "Erro de rede ao renovar a conexão Tiny." };
  }
}
