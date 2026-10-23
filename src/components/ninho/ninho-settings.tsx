"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Cloud, Copy, Link2, RefreshCw, Users } from "lucide-react";
import { operationalHealth, type ConnectionHealth } from "@/lib/connection-status";
import { ConnectionStatus } from "@/components/ui/connection-status";
import { NuvemshopConnection } from "@/components/ninho/nuvemshop-connection";
import { NinhoUsers } from "@/components/ninho/ninho-users";
import { AnalyticsConnections } from "@/components/ninho/analytics-connections";
import { NinhoSection } from "./ninho-section";
import type { OlistWebhookStatus } from "@/types";

type OlistStatus = { status?: string; health?: ConnectionHealth; isConnected: boolean; needsReconnect?: boolean; message?: string | null };
type ConnectionWebhook = { id: string; name: string; url: string | null; lastReceivedAt: string | null };
type Webhook = { enabled: boolean; url: string | null; status: OlistWebhookStatus; connections?: ConnectionWebhook[] };
const oauthErrors: Record<string, string> = {
  OAuthValidationFailed: "A tentativa de conexão expirou. Conecte a Olist novamente.",
  OAuthProviderDenied: "A Olist não autorizou a conexão. Confira a conta e suas permissões.",
  OAuthCodeMissing: "A Olist não retornou o código de autorização.",
  TokenExchangeFailed: "A Olist recusou a finalização da conexão. Tente novamente.",
  ConfigurationError: "As credenciais da integração estão incompletas no servidor.",
  CallbackError: "A conexão não pôde ser salva. Tente novamente.",
};

export function NinhoSettings() {
  const router = useRouter();
  const [tab, setTab] = useState<"connections" | "users">("connections");
  const [olist, setOlist] = useState<OlistStatus | null>(null);
  const [webhook, setWebhook] = useState<Webhook | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState<string | null>(null);
  const refreshWebhooks = useCallback(async () => {
    const response = await fetch("/api/ninho/webhook", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as configurações.");
    setWebhook(payload);
  }, []);
  const load = useCallback(async (verify = false) => {
    const [response] = await Promise.all([fetch(`/api/auth/status${verify ? "?verify=1" : ""}`, { cache: "no-store" }), refreshWebhooks()]);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Não foi possível carregar as configurações.");
    setOlist(payload);
  }, [refreshWebhooks]);
  useEffect(() => {
    void load().catch(reason => setError(reason.message));
    const params = new URLSearchParams(window.location.search);
    if (params.has("error")) setError(oauthErrors[params.get("error") || ""] || "Não foi possível concluir a conexão Olist.");
    if (params.has("success")) setNotice("Olist conectada para toda a colmeia.");
    if (params.has("error") || params.has("success")) window.history.replaceState({}, "", "/ninho");
  }, [load]);
  async function action(kind: "verify" | "refresh" | "disconnect" | "enable" | "disable" | "rotate") {
    if (kind === "disconnect" && !window.confirm("Remover a conexão Olist para toda a equipe?")) return;
    if (kind === "rotate" && !window.confirm("Gerar uma nova URL? A URL antiga deixará de funcionar e você precisará atualizar o cadastro na Olist.")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      if (kind !== "verify" && kind !== "refresh") {
        const response = await fetch(kind === "disconnect" ? "/api/auth/disconnect" : "/api/ninho/webhook", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: kind }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Não foi possível alterar a configuração.");
      }
      await load(kind === "verify");
      setNotice(kind === "rotate" ? "Nova URL gerada. Atualize o webhook na Olist." : kind === "verify" ? "Verificação concluída." : "Configuração atualizada.");
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Falha ao configurar a integração."); }
    finally { setBusy(false); }
  }
  const health = olist ? olist.health || operationalHealth(olist) : null;
  return <div className="space-y-6">

    <div className="app-tabs" role="tablist" aria-label="Configurações do Ninho"
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? "connections" : event.key === "End" ? "users" : tab === "connections" ? "users" : "connections";
        setTab(next); document.getElementById(`${next}-tab`)?.focus();
      }}>
      <button role="tab" tabIndex={tab === "connections" ? 0 : -1} aria-selected={tab === "connections"} aria-controls="ninho-connections" id="connections-tab"
        className="app-tab flex-1 sm:flex-none"
        onClick={() => setTab("connections")}><Link2 aria-hidden="true" className="w-4 h-4 shrink-0" />Conexões</button>
      <button role="tab" tabIndex={tab === "users" ? 0 : -1} aria-selected={tab === "users"} aria-controls="ninho-users" id="users-tab"
        className="app-tab flex-1 sm:flex-none"
        onClick={() => setTab("users")}><Users aria-hidden="true" className="w-4 h-4 shrink-0" />Usuários e permissões</button>
    </div>
    {error && <p role="alert" className="card p-4 text-[var(--color-accent-red)]">{error}</p>}
    {notice && <p role="status" className="card p-4 text-[var(--color-accent-green)]">{notice}</p>}
    <div role="tabpanel" id="ninho-connections" aria-labelledby="connections-tab" hidden={tab !== "connections"} className="space-y-6">
      <AnalyticsConnections onRefreshWebhooks={refreshWebhooks} />
      <div className="space-y-3">
      <h2 className="text-sm font-semibold text-[var(--color-text-secondary)]">Integrações operacionais</h2>
      <div className="grid items-start gap-4 lg:grid-cols-2">
      <NinhoSection title="Olist ERP" icon={Cloud}
        status={health ? <ConnectionStatus health={health} /> : <span className="badge">Verificando…</span>}
        actions={(health?.action === "authorize" || health?.action === "reconnect") && <a className={`btn-primary ${busy ? "pointer-events-none opacity-50" : ""}`} href="/api/auth/login">{health.action === "reconnect" ? "Reconectar Olist" : "Conectar Olist"}</a>}>
        {olist?.message && <p className="text-sm text-[var(--color-accent-orange)]">{olist.message}</p>}
        <div className="flex flex-wrap gap-3"><button className="btn-ghost" disabled={busy || !olist} onClick={() => action("verify")}><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />Verificar acesso</button><button className="btn-ghost text-[var(--color-accent-red)]" disabled={busy || !olist} onClick={() => action("disconnect")}>Remover conexão</button></div>
      </NinhoSection>
      <NuvemshopConnection />
      </div>
      </div>
      <NinhoSection title="Webhook Olist" icon={Link2} iconClassName="bg-[var(--color-accent-green)]/10 text-[var(--color-accent-green)]"
        status={<span className={`badge ${webhook?.enabled && webhook.status.status === "active" ? "badge-checked" : "badge-pending"}`}>
          {!webhook ? "Verificando…" : !webhook.enabled ? "Pausado" : webhook.connections?.length ? `${webhook.connections.length} conexões` : webhook.status.status === "active" ? "Ativo" : webhook.status.status === "pending" ? "Aguardando" : "Indisponível"}
        </span>}
        actions={webhook && <button className="btn-ghost" disabled={busy} onClick={() => action(webhook.enabled ? "disable" : "enable")}>{webhook.enabled ? "Pausar recebimento" : "Ativar recebimento"}</button>}>
        {webhook ? <>
          <div className="grid items-start gap-4 xl:grid-cols-3">
            {webhook.connections?.map(connection => <article key={connection.id} aria-label={`Webhook ${connection.name}`} className="min-w-0 space-y-3 rounded-2xl border border-[var(--color-border-light)] p-4">
              <h3 className="font-semibold">{connection.name}</h3>
              {connection.url ? <>
                <label className="block text-xs">URL para notificações de vendas · {connection.name}
                  <input readOnly className="field mt-1 text-xs" value={connection.url} onFocus={event => event.target.select()} />
                </label>
                <button className="btn-ghost" aria-label={`Copiar webhook de ${connection.name}`} onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(connection.url!);
                    setCopiedWebhook(connection.id);
                    setTimeout(() => setCopiedWebhook(current => current === connection.id ? null : current), 2000);
                  } catch { setError("Selecione a URL do webhook desta conexão e copie manualmente."); }
                }}><Copy className="w-4 h-4" />{copiedWebhook === connection.id ? "URL copiada" : "Copiar URL"}</button>
              </> : <p className="text-xs text-[var(--color-accent-orange)]">Webhook indisponível para esta conexão.</p>}
              <p className="text-xs text-[var(--color-text-secondary)]">{connection.lastReceivedAt ? `Último evento: ${new Date(connection.lastReceivedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília).` : "Aguardando o primeiro evento."}</p>
            </article>)}
          </div>
          <button className="btn-ghost" disabled={busy} onClick={() => action("refresh")}>Atualizar status</button>
          <details open={!webhook.connections?.length || undefined} className="space-y-3 border-t border-[var(--color-border-light)] pt-3">
          <summary className="cursor-pointer text-sm font-medium">URL anterior do webhook</summary>
          <p className="text-sm">{!webhook.enabled ? "Recebimento pausado." : webhook.status.status === "active" ? `Última notificação: ${new Date(webhook.status.lastReceivedAt!).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília).` : webhook.status.status === "pending" ? "Aguardando a primeira notificação da Olist." : "Status de recebimento indisponível."}</p>
          {webhook.url ? <><label className="block text-sm">URL para Notificações de vendas na Olist<input readOnly className="field mt-2 text-xs" value={webhook.url} onFocus={event => event.target.select()} /></label><button className="btn-ghost" onClick={async () => { try { await navigator.clipboard.writeText(webhook.url!); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError("Selecione a URL e copie manualmente."); } }}><Copy className="w-4 h-4" />{copied ? "URL copiada" : "Copiar URL"}</button></> : <p className="text-sm text-[var(--color-accent-orange)]">A chave do webhook precisa ser configurada no servidor.</p>}
          <button className="btn-ghost" disabled={busy || !webhook.url} onClick={() => action("rotate")}>Gerar nova URL</button>
          </details></> : <p className="text-sm">Verificando webhook…</p>}
      </NinhoSection>
    </div>
    <div role="tabpanel" id="ninho-users" aria-labelledby="users-tab" hidden={tab !== "users"}><NinhoUsers /></div>
  </div>;
}
