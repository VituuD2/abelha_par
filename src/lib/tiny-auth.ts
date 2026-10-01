import "server-only";

import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/token-crypto";

const TINY_TOKEN_URL = "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";
const FIELDS = "id, access_token, refresh_token, expires_at, refresh_expires_at";
const REFRESH_MARGIN_MS = 6 * 60 * 60_000;
const inFlight = new Map<string, Promise<TokenResult>>();

export type TokenStatus = "valid" | "refreshed" | "expired" | "error";
export interface TokenResult { token: string | null; status: TokenStatus; message?: string }
interface Integration {
  id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string | null;
}
const failure = (message: string): TokenResult => ({ token: null, status: "error", message });
const expired = (): TokenResult => ({ token: null, status: "expired", message: "A autorização Olist expirou ou foi revogada. Reconecte a conta." });
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Coalesce calls locally; the database lease also covers other instances. */
export function getValidTinyToken(userId: string, minimumValidityMs = 300_000): Promise<TokenResult> {
  const existing = inFlight.get(userId);
  if (existing) return existing;
  const pending = getToken(userId, minimumValidityMs)
    .catch(() => failure("Não foi possível consultar ou renovar a conexão Olist. Tente novamente."))
    .finally(() => { inFlight.delete(userId); });
  inFlight.set(userId, pending);
  return pending;
}
async function readIntegration(userId: string) {
  return createAdminClient().from("tiny_integrations").select(FIELDS).eq("owner_id", userId)
    .abortSignal(AbortSignal.timeout(3_000)).maybeSingle();
}
async function getToken(userId: string, minimumValidityMs: number): Promise<TokenResult> {
  const { data, error } = await readIntegration(userId);
  if (error) return failure("Não foi possível consultar a conexão Olist no banco. Tente novamente.");
  if (!data) return expired();
  const integration = data as Integration;
  const now = Date.now();
  const accessRemaining = Date.parse(integration.expires_at) - now;
  const refreshRemaining = integration.refresh_expires_at ? Date.parse(integration.refresh_expires_at) - now : Infinity;
  try {
    const accessToken = decryptToken(integration.access_token);
    // An expired refresh credential does not invalidate a still usable access token.
    if (refreshRemaining <= 0) return accessRemaining > 30_000
      ? { token: accessToken, status: "valid", message: "A renovação expirou. Reconecte a Olist antes do vencimento do acesso atual." }
      : expired();
    if (accessRemaining >= minimumValidityMs && refreshRemaining > REFRESH_MARGIN_MS) {
      return { token: accessToken, status: "valid" };
    }
    const refreshed = await refreshToken(userId, integration);
    if (refreshed.status === "error" && Date.parse(integration.expires_at) - Date.now() > 30_000) {
      return { token: accessToken, status: "valid", message: refreshed.message };
    }
    return refreshed;
  } catch {
    return failure("Não foi possível abrir a credencial Olist. Verifique a chave de criptografia do servidor.");
  }
}
async function refreshToken(userId: string, integration: Integration): Promise<TokenResult> {
  const clientId = process.env.TINY_CLIENT_ID;
  const clientSecret = process.env.TINY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return failure("Credenciais Olist ausentes no servidor.");
  const refreshToken = decryptToken(integration.refresh_token);
  const db = createAdminClient();
  const lock = randomUUID();
  const now = new Date();
  const { data: claimed, error: claimError } = await db.from("tiny_integrations")
    .update({ refresh_lock: lock, refresh_locked_until: new Date(now.getTime() + 90_000).toISOString() })
    .eq("id", integration.id).eq("owner_id", userId).eq("refresh_token", integration.refresh_token)
    .or(`refresh_locked_until.is.null,refresh_locked_until.lt.${now.toISOString()}`)
    .select("id").abortSignal(AbortSignal.timeout(3_000)).maybeSingle();
  if (claimError) return failure("Não foi possível reservar a renovação Olist. Verifique a migração v8 do banco.");
  if (!claimed) {
    // Another instance may be rotating the pair. Never reuse its old refresh token.
    const waitUntil = Date.now() + 10_000;
    while (Date.now() < waitUntil) {
      await sleep(500);
      const { data: current, error } = await readIntegration(userId);
      if (error) return failure("Não foi possível acompanhar a renovação Olist.");
      if (!current) return expired();
      if (current.refresh_token !== integration.refresh_token || current.access_token !== integration.access_token) {
        if (Date.parse(current.expires_at) - Date.now() > 30_000) {
          return { token: decryptToken(current.access_token), status: "valid" };
        }
        return failure("A conexão Olist mudou durante a renovação. Tente novamente.");
      }
    }
    return failure("Renovação Olist em andamento. Aguarde alguns segundos e tente novamente.");
  }
  try {
    const issuedAt = Date.now();
    const response = await fetch(TINY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      // invalid_client, rate limits and outages do not require a new login.
      if (response.status === 400 && data?.error === "invalid_grant") {
        const { data: current, error } = await readIntegration(userId);
        if (error) return failure("Não foi possível verificar a autorização Olist.");
        if (current && current.refresh_token !== integration.refresh_token && Date.parse(current.expires_at) > Date.now() + 30_000) {
          return { token: decryptToken(current.access_token), status: "valid" };
        }
        return expired();
      }
      return failure(data?.error === "invalid_client"
        ? "A Olist recusou as credenciais do aplicativo. Confira TINY_CLIENT_ID e TINY_CLIENT_SECRET no servidor."
        : "A Olist não conseguiu renovar a conexão agora. Tente novamente.");
    }
    if (typeof data?.access_token !== "string" || !data.access_token || typeof data?.refresh_token !== "string" || !data.refresh_token
      || typeof data.expires_in !== "number" || !Number.isFinite(data.expires_in) || data.expires_in <= 0
      || (data.refresh_expires_in !== undefined && (typeof data.refresh_expires_in !== "number" || !Number.isFinite(data.refresh_expires_in) || data.refresh_expires_in < 0))) {
      return failure("A Olist retornou uma resposta de renovação inválida.");
    }
    const payload = {
      access_token: encryptToken(data.access_token),
      refresh_token: encryptToken(data.refresh_token),
      expires_at: new Date(issuedAt + data.expires_in * 1000).toISOString(),
      // Omission does not imply an unlimited refresh lifetime. Preserve the known deadline.
      refresh_expires_at: data.refresh_expires_in === 0 ? null : data.refresh_expires_in
        ? new Date(issuedAt + data.refresh_expires_in * 1000).toISOString() : integration.refresh_expires_at,
      updated_at: new Date().toISOString(),
    };
    // Retry persistence of the SAME pair; do not repeat a successful OAuth exchange.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: saved, error } = await db.from("tiny_integrations").update(payload)
        .eq("id", integration.id).eq("owner_id", userId).eq("refresh_lock", lock)
        .eq("refresh_token", integration.refresh_token).select("id").abortSignal(AbortSignal.timeout(3_000)).maybeSingle();
      if (!error && saved) return { token: data.access_token, status: "refreshed" };
      // A DB timeout may occur after commit, or the user may have reconnected/disconnected.
      const { data: current, error: readError } = await readIntegration(userId);
      if (!readError && current?.refresh_token === payload.refresh_token) return { token: data.access_token, status: "refreshed" };
      if (!readError && (!current || current.refresh_token !== integration.refresh_token)) {
        return failure("A conexão Olist mudou durante a renovação. Atualize a página.");
      }
      if (attempt < 2) await sleep(250 * (attempt + 1));
    }
    return failure("Token renovado, mas não foi possível salvá-lo. Verifique a disponibilidade do banco.");
  } catch {
    return failure("Falha temporária ao renovar a conexão Olist. Tente novamente.");
  } finally {
    // A late worker cannot clear another worker's lease.
    await db.from("tiny_integrations").update({ refresh_lock: null, refresh_locked_until: null })
      .eq("id", integration.id).eq("owner_id", userId).eq("refresh_lock", lock)
      .abortSignal(AbortSignal.timeout(3_000));
  }
}
