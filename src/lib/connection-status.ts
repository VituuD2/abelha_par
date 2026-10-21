/** Shared presentation contract. Authorization and synchronization are independent. */
export type ConnectionHealth = {
  code: "connected" | "paused" | "configuration_required" | "authorization_required" | "link_required" | "permission_required" | "identity_mismatch" | "verification_required" | "unavailable";
  label: string;
  tone: "success" | "warning" | "neutral";
  action: "configure" | "authorize" | "reconnect" | "relink" | "verify" | null;
};
export type ConnectionMetadata = {
  enabled: boolean; credential_kind: string; client_id?: string | null;
  legacy_integration_id?: string | null; expires_at?: string | null;
  refresh_expires_at?: string | null; verified_at?: string | null;
  error_code?: string | null;
};
export function connectionHealth(c: ConnectionMetadata, now = Date.now()): ConnectionHealth {
  if (!c.enabled) return { code: "paused", label: "Pausada", tone: "neutral", action: null };
  if (c.credential_kind === "legacy" && !c.legacy_integration_id)
    return { code: "link_required", label: "Vínculo operacional perdido", tone: "warning", action: "relink" };
  if (c.credential_kind !== "legacy" && !c.client_id)
    return { code: "configuration_required", label: "Aplicativo pendente", tone: "warning", action: "configure" };
  if (c.credential_kind !== "legacy" && !c.expires_at)
    return { code: "authorization_required", label: "Autorização pendente", tone: "warning", action: "authorize" };
  if (c.error_code === "identity_mismatch")
    return { code: "identity_mismatch", label: "CNPJ divergente", tone: "warning", action: "verify" };
  if (c.error_code === "permission_required")
    return { code: "permission_required", label: "Revisar permissões", tone: "warning", action: null };
  // An expired access token alone is normal: the server renews it using refresh.
  if (c.error_code === "authorization_required")
    return { code: "authorization_required", label: "Autorização expirada", tone: "warning", action: "reconnect" };
  if (c.refresh_expires_at && Date.parse(c.refresh_expires_at) <= now)
    return { code: "authorization_required", label: Date.parse(c.expires_at || "") > now ? "Renovação expirada" : "Autorização expirada", tone: "warning", action: "reconnect" };
  if (!c.verified_at)
    return { code: "verification_required", label: "Validação pendente", tone: "warning", action: "verify" };
  return { code: "connected", label: "Conectada", tone: "success", action: null };
}

export function operationalHealth(value: { isConnected: boolean; needsReconnect?: boolean; status?: string }): ConnectionHealth {
  if (value.needsReconnect || value.status === "expired")
    return { code: "authorization_required", label: value.isConnected ? "Renovação expirada" : "Autorização expirada", tone: "warning", action: "reconnect" };
  if (value.status === "access_denied")
    return { code: "permission_required", label: "Revisar permissões", tone: "warning", action: null };
  if (value.isConnected) return { code: "connected", label: "Conectada", tone: "success", action: null };
  if (value.status === "missing")
    return { code: "authorization_required", label: "Não conectada", tone: "neutral", action: "authorize" };
  return { code: "unavailable", label: "Verificação indisponível", tone: "warning", action: null };
}
