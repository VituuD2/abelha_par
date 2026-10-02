import "server-only";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/token-crypto";
import { getValidTinyToken } from "@/lib/tiny-auth";
import type { AnalyticsConnection } from "./types";
import { olistRequest } from "./olist-client";
import { string } from "./normalize";

export const TOKEN_URL =
  "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token";

/** A legacy reconnect may switch ERP accounts without changing the integration row ID. */
export async function ensureAnalyticsIdentity(
  workspace: string,
  connectionId: string,
  token: string,
) {
  const db = createAdminClient();
  const current = await db
    .from("analytics_connections")
    .select(
      "id,company_id,version,enabled,verified_tax_id,verified_token_fingerprint",
    )
    .eq("workspace_id", workspace)
    .eq("id", connectionId)
    .single();
  if (current.error || !current.data?.enabled)
    throw new Error("Conexão analítica indisponível.");
  const c = current.data;
  const company = await db
    .from("analytics_companies")
    .select("tax_id")
    .eq("workspace_id", workspace)
    .eq("id", c.company_id)
    .single();
  if (company.error || !company.data?.tax_id)
    throw new Error(
      "Identifique o CNPJ desta empresa no Ninho antes de importar.",
    );
  const fingerprint = createHash("sha256").update(token).digest("hex");
  if (
    c.verified_tax_id === company.data.tax_id &&
    c.verified_token_fingerprint === fingerprint
  )
    return;
  const info = await olistRequest(token, c.id, "/info"),
    tax = string(info.cpfCnpj).replace(/\D/g, "");
  if (tax !== company.data.tax_id)
    throw new Error(
      "O CNPJ da autorização Olist mudou ou não corresponde à empresa. Importação bloqueada para preservar a separação dos dados.",
    );
  const saved = await db
    .from("analytics_connections")
    .update({
      verified_tax_id: tax,
      verified_at: new Date().toISOString(),
      verified_token_fingerprint: fingerprint,
    })
    .eq("workspace_id", workspace)
    .eq("id", c.id)
    .eq("version", c.version)
    .eq("enabled", true)
    .select("id")
    .single();
  if (saved.error)
    throw new Error("A conexão mudou durante a validação da empresa.");
}
type State = {
  user: string;
  workspace: string;
  connection: string;
  version: number;
  flow: string;
  expires: number;
};
function sign(raw: string) {
  if (!process.env.TOKEN_ENCRYPTION_KEY)
    throw new Error("Chave de criptografia não configurada.");
  const key = createHash("sha256")
    .update("abelha-par:analytics:oauth:v1")
    .update(process.env.TOKEN_ENCRYPTION_KEY)
    .digest();
  return createHmac("sha256", key).update(raw).digest("base64url");
}
export function createAnalyticsState(
  user: string,
  connection: AnalyticsConnection,
): { state: string; payload: State } {
  const payload = {
    user,
    workspace: connection.workspace_id,
    connection: connection.id,
    version: connection.version,
    flow: randomUUID(),
    expires: Date.now() + 600000,
  };
  const raw = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { state: `${raw}.${sign(raw)}`, payload };
}
export function verifyAnalyticsState(
  value: string,
  user: string,
  workspace: string,
): State | null {
  const [raw, signature, extra] = value.split(".");
  if (!raw || !signature || extra || value.length > 2000) return null;
  const expected = Buffer.from(sign(raw)),
    actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null;
  try {
    const state = JSON.parse(Buffer.from(raw, "base64url").toString()) as State;
    return state.user === user &&
      state.workspace === workspace &&
      typeof state.connection === "string" &&
      typeof state.flow === "string" &&
      Number.isInteger(state.version) &&
      Number.isFinite(state.expires) &&
      state.expires > Date.now()
      ? state
      : null;
  } catch {
    return null;
  }
}
export function tokenPayload(
  data: Record<string, unknown>,
  issuedAt: number,
  previousRefreshExpiry: string | null = null,
) {
  if (
    typeof data.access_token !== "string" ||
    !data.access_token ||
    typeof data.refresh_token !== "string" ||
    !data.refresh_token ||
    typeof data.expires_in !== "number" ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0 ||
    (data.refresh_expires_in !== undefined &&
      (typeof data.refresh_expires_in !== "number" ||
        !Number.isFinite(data.refresh_expires_in) ||
        data.refresh_expires_in < 0))
  )
    throw new Error("Resposta OAuth inválida.");
  return {
    access_token: encryptToken(data.access_token),
    refresh_token: encryptToken(data.refresh_token),
    expires_at: new Date(issuedAt + data.expires_in * 1000).toISOString(),
    refresh_expires_at:
      data.refresh_expires_in === 0
        ? null
        : typeof data.refresh_expires_in === "number"
          ? new Date(issuedAt + data.refresh_expires_in * 1000).toISOString()
          : previousRefreshExpiry,
  };
}
const flights = new Map<string, Promise<string>>();
export async function refreshDueAnalyticsTokens() {
  const now = Date.now();
  const { data, error } = await createAdminClient()
    .from("analytics_connections")
    .select("id,workspace_id")
    .eq("enabled", true)
    .eq("credential_kind", "oauth")
    .not("access_token", "is", null)
    .or(
      `expires_at.lt.${new Date(now + 65 * 60000).toISOString()},refresh_expires_at.lt.${new Date(now + 6 * 3600000).toISOString()}`,
    )
    .order("expires_at")
    .limit(1);
  if (error)
    throw new Error("Não foi possível consultar as renovações analíticas.");
  for (const c of data || []) {
    try {
      await analyticsToken(c.workspace_id, c.id);
    } catch (reason) {
      await createAdminClient()
        .from("analytics_connections")
        .update({
          last_error:
            reason instanceof Error ? reason.message : "Renovação pendente.",
        })
        .eq("workspace_id", c.workspace_id)
        .eq("id", c.id);
    }
  }
}
export function analyticsToken(
  workspace: string,
  connectionId: string,
): Promise<string> {
  const key = workspace + connectionId,
    prior = flights.get(key);
  if (prior) return prior;
  const pending = getToken(workspace, connectionId).finally(() =>
    flights.delete(key),
  );
  flights.set(key, pending);
  return pending;
}
async function read(workspace: string, connectionId: string) {
  const { data, error } = await createAdminClient()
    .from("analytics_connections")
    .select("*")
    .eq("workspace_id", workspace)
    .eq("id", connectionId)
    .abortSignal(AbortSignal.timeout(3000))
    .maybeSingle();
  if (error || !data?.enabled)
    throw new Error("Conexão analítica indisponível.");
  return data as AnalyticsConnection;
}
async function getToken(
  workspace: string,
  connectionId: string,
): Promise<string> {
  const c = await read(workspace, connectionId);
  // A removed legacy integration must never fall through to a different OAuth account.
  if (
    (c as AnalyticsConnection & { credential_kind: string }).credential_kind ===
    "legacy"
  ) {
    if (!c.legacy_integration_id)
      throw new Error(
        "A conexão operacional foi removida. Configure novamente no Ninho.",
      );
    const result = await getValidTinyToken(workspace);
    if (!result.token)
      throw new Error(result.message || "Reconecte a Olist atual.");
    return result.token;
  }
  if (!c.access_token || !c.refresh_token || !c.client_id || !c.client_secret)
    throw new Error("Autorize esta conexão Olist no Ninho.");
  if (
    Date.parse(c.expires_at || "") > Date.now() + 300000 &&
    (!c.refresh_expires_at ||
      Date.parse(c.refresh_expires_at) > Date.now() + 6 * 3600000)
  )
    return decryptToken(c.access_token);
  if (c.refresh_expires_at && Date.parse(c.refresh_expires_at) < Date.now()) {
    if (Date.parse(c.expires_at || "") > Date.now() + 30000)
      return decryptToken(c.access_token);
    throw new Error("A autorização expirou. Reconecte esta empresa no Ninho.");
  }
  const db = createAdminClient(),
    lease = randomUUID();
  const { data: claimed, error } = await db
    .from("analytics_connections")
    .update({
      refresh_lock: lease,
      refresh_locked_until: new Date(Date.now() + 90000).toISOString(),
    })
    .eq("workspace_id", workspace)
    .eq("id", c.id)
    .eq("refresh_token", c.refresh_token)
    .eq("version", c.version)
    .or(
      `refresh_locked_until.is.null,refresh_locked_until.lt.${new Date().toISOString()}`,
    )
    .select("id")
    .abortSignal(AbortSignal.timeout(3000))
    .maybeSingle();
  if (error) throw new Error("Não foi possível reservar a renovação Olist.");
  if (!claimed) {
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const fresh = await read(workspace, connectionId);
      if (
        fresh.access_token &&
        fresh.refresh_token !== c.refresh_token &&
        Date.parse(fresh.expires_at || "") > Date.now() + 30000
      )
        return decryptToken(fresh.access_token);
    }
    throw new Error("Renovação em andamento. A sincronização será retomada.");
  }
  try {
    const issuedAt = Date.now();
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: c.client_id,
        client_secret: decryptToken(c.client_secret),
        refresh_token: decryptToken(c.refresh_token),
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        body?.error === "invalid_grant"
          ? "Reconecte esta conta Olist; autorização expirada ou revogada."
          : "Falha temporária na renovação Olist. Verifique as credenciais do aplicativo.",
      );
    const payload = tokenPayload(body, issuedAt, c.refresh_expires_at);
    for (let attempt = 0; attempt < 3; attempt++) {
      const saved = await db
        .from("analytics_connections")
        .update(payload)
        .eq("workspace_id", workspace)
        .eq("id", c.id)
        .eq("refresh_lock", lease)
        .eq("version", c.version)
        .eq("refresh_token", c.refresh_token)
        .select("id")
        .abortSignal(AbortSignal.timeout(3000))
        .maybeSingle();
      if (!saved.error && saved.data) return body.access_token;
      const fresh = await read(workspace, connectionId);
      if (fresh.refresh_token === payload.refresh_token)
        return body.access_token;
      if (
        fresh.version !== c.version ||
        fresh.refresh_token !== c.refresh_token
      )
        throw new Error("Conexão alterada durante a renovação.");
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("Não foi possível persistir a credencial renovada.");
  } finally {
    await db
      .from("analytics_connections")
      .update({ refresh_lock: null, refresh_locked_until: null })
      .eq("workspace_id", workspace)
      .eq("id", c.id)
      .eq("refresh_lock", lease)
      .abortSignal(AbortSignal.timeout(3000));
  }
}
