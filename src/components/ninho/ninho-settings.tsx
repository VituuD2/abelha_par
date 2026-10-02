"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Cloud, Copy, Link2, RefreshCw, ShieldCheck, Users } from "lucide-react";
import { BeeSettingsIcon } from "@/components/layout/bee-settings-icon";
import { NuvemshopConnection } from "@/components/ninho/nuvemshop-connection";
import { NinhoUsers } from "@/components/ninho/ninho-users";
import { AnalyticsConnections } from "@/components/ninho/analytics-connections";
import type { OlistWebhookStatus } from "@/types";

type OlistStatus = { isConnected: boolean; needsReconnect?: boolean; message?: string | null };
type Webhook = { enabled: boolean; url: string | null; status: OlistWebhookStatus };
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
  const load = useCallback(async (verify = false) => {
    const responses = await Promise.all([fetch(`/api/auth/status${verify ? "?verify=1" : ""}`, { cache: "no-store" }), fetch("/api/ninho/webhook", { cache: "no-store" })]);
    const payloads = await Promise.all(responses.map(response => response.json()));
    for (let index = 0; index < responses.length; index++) if (!responses[index].ok) throw new Error(payloads[index].error || "Não foi possível carregar as configurações.");
    setOlist(payloads[0]); setWebhook(payloads[1]);
  }, []);
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
  return <div className="space-y-6">
    <div className="card p-5 flex items-center gap-4 bg-gradient-to-r from-amber-100/70 to-transparent"><BeeSettingsIcon className="w-10 h-10 text-amber-700 shrink-0" /><div className="flex-1"><p className="font-semibold">Uma colmeia, conexões compartilhadas</p><p className="text-sm text-[var(--color-text-secondary)] mt-1">A equipe usa as integrações. Os administradores cuidam das configurações e dos acessos.</p></div><ShieldCheck className="w-6 h-6 text-amber-700 shrink-0 hidden sm:block" /></div>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Configurações do Ninho"><button role="tab" aria-selected={tab === "connections"} aria-controls="ninho-connections" id="connections-tab" className={tab === "connections" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("connections")}><Link2 className="w-4 h-4" />Conexões</button><button role="tab" aria-selected={tab === "users"} aria-controls="ninho-users" id="users-tab" className={tab === "users" ? "btn-primary" : "btn-ghost"} onClick={() => setTab("users")}><Users className="w-4 h-4" />Usuários e permissões</button></div>
    {error && <p role="alert" className="card p-4 text-[var(--color-accent-red)]">{error}</p>}
    {notice && <p role="status" className="card p-4 text-[var(--color-accent-green)]">{notice}</p>}
    <div role="tabpanel" id="ninho-connections" aria-labelledby="connections-tab" hidden={tab !== "connections"} className="space-y-6">
      <section className="card p-6 sm:p-7 space-y-5"><div className="flex items-center gap-3"><div className="p-3 rounded-xl bg-amber-100"><Cloud className="w-6 h-6 text-amber-700" /></div><div className="flex-1"><h2 className="text-lg font-semibold">Olist ERP</h2><p className="text-sm text-[var(--color-text-secondary)]">Pedidos, rastreios e renovação automática da conexão.</p></div><span className={`badge ${olist?.isConnected ? "badge-checked" : "badge-pending"}`}>{!olist ? "Verificando…" : olist.isConnected ? "Conectada" : "Indisponível"}</span></div>
        {olist?.message && <p className="text-sm text-[var(--color-accent-orange)]">{olist.message}</p>}
        <div className="flex flex-wrap gap-3"><a className={`btn-primary ${busy ? "pointer-events-none opacity-50" : ""}`} href="/api/auth/login">{olist?.isConnected || olist?.needsReconnect ? "Reconectar Olist" : "Conectar Olist"}</a><button className="btn-ghost" disabled={busy || !olist} onClick={() => action("verify")}><RefreshCw className={`w-4 h-4 ${busy ? "animate-spin" : ""}`} />Verificar acesso</button><button className="btn-ghost text-[var(--color-accent-red)]" disabled={busy || !olist} onClick={() => action("disconnect")}>Remover conexão</button></div>
      </section>
      <NuvemshopConnection />
      <AnalyticsConnections />
      <section className="card p-6 sm:p-7 space-y-5"><div className="flex items-center gap-3"><div className="p-3 rounded-xl bg-[var(--color-accent-green)]/10"><Link2 className="w-6 h-6 text-[var(--color-accent-green)]" /></div><div><h2 className="text-lg font-semibold">Webhook Olist</h2><p className="text-sm text-[var(--color-text-secondary)]">Atualize os pedidos quando a Olist enviar uma notificação.</p></div></div>
        {webhook ? <><p className="text-sm">{!webhook.enabled ? "Recebimento pausado." : webhook.status.status === "active" ? `Última notificação: ${new Date(webhook.status.lastReceivedAt!).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília).` : webhook.status.status === "pending" ? "Aguardando a primeira notificação da Olist." : "Status de recebimento indisponível."}</p>
          {webhook.url ? <><label className="block text-sm">URL para Notificações de vendas na Olist<input readOnly className="field mt-2 text-xs" value={webhook.url} onFocus={event => event.target.select()} /></label><button className="btn-ghost" onClick={async () => { try { await navigator.clipboard.writeText(webhook.url!); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError("Selecione a URL e copie manualmente."); } }}><Copy className="w-4 h-4" />{copied ? "URL copiada" : "Copiar URL"}</button></> : <p className="text-sm text-[var(--color-accent-orange)]">A chave do webhook precisa ser configurada no servidor.</p>}
          <div className="flex flex-wrap gap-3"><button className="btn-primary" disabled={busy} onClick={() => action(webhook.enabled ? "disable" : "enable")}>{webhook.enabled ? "Pausar recebimento" : "Ativar recebimento"}</button><button className="btn-ghost" disabled={busy || !webhook.url} onClick={() => action("rotate")}>Gerar nova URL</button><button className="btn-ghost" disabled={busy} onClick={() => action("refresh")}>Atualizar status</button></div></> : <p className="text-sm">Verificando webhook…</p>}
      </section>
    </div>
    <div role="tabpanel" id="ninho-users" aria-labelledby="users-tab" hidden={tab !== "users"}><NinhoUsers /></div>
  </div>;
}
