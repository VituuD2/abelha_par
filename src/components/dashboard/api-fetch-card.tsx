"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Cloud, Loader2, Check, AlertCircle, Link as LinkIcon, ExternalLink, RefreshCw, Copy } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { OlistOrder, OlistWebhookStatus, ReconciliationConfig } from "@/types";
import { isValidDateRange } from "@/lib/dates";

interface ApiFetchCardProps {
  onFetch: (orders: OlistOrder[], dateMode: "created" | "updated", mapping: ReconciliationConfig | null) => void;
  onFetchStart: () => void;
  disabled?: boolean;
}

// Poll auth status every 10 minutes to detect token expiration proactively
const AUTH_POLL_INTERVAL = 10 * 60 * 1000;

function getOAuthErrorMessage(error: string) {
  const messages: Record<string, string> = {
    OAuthValidationFailed: "A tentativa de conexão expirou ou pertence a outra sessão. Clique em conectar novamente.",
    OAuthProviderDenied: "A Olist não autorizou esta conexão. Confirme a conta e as permissões e tente novamente.",
    OAuthCodeMissing: "A Olist não retornou o código de autorização. Tente conectar novamente.",
    TokenExchangeFailed: "A Olist recusou a finalização da conexão. Tente novamente em alguns instantes.",
    ConfigurationError: "A configuração da integração está incompleta no servidor.",
    CallbackError: "A conexão foi autorizada, mas não pôde ser salva. Tente novamente.",
  };
  return messages[error] || "Não foi possível concluir a autenticação com a Olist.";
}

export function ApiFetchCard({ onFetch, onFetchStart, disabled }: ApiFetchCardProps) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [dateMode, setDateMode] = useState<"created" | "updated">("updated");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [hasOrdersAccessDenied, setHasOrdersAccessDenied] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchedCount, setFetchedCount] = useState<number | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<OlistWebhookStatus>({ status: "unknown", lastReceivedAt: null });
  const [showWebhookConfig, setShowWebhookConfig] = useState(false);
  const [isCheckingWebhook, setIsCheckingWebhook] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchController = useRef<AbortController | null>(null);
  useEffect(() => () => fetchController.current?.abort(), []);

  const checkAuthStatus = useCallback(async (showLoading = false) => {
    if (showLoading) setIsCheckingAuth(true);
    try {
      const res = await fetch("/api/auth/status", { cache: "no-store" });
      if (res.status === 401) {
        console.error("[tiny-status] application session rejected", {
          requestId: res.headers.get("x-vercel-id"),
        });
        // The Tiny OAuth flow can complete while the application's Supabase
        // session has expired. Re-authenticate the app instead of presenting
        // this as a Tiny connection problem.
        window.location.replace("/login?next=%2F");
        return;
      }

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Não foi possível verificar a conexão Tiny.");
      
      setIsConnected(data.isConnected);
      setNeedsReconnect(data.needsReconnect || false);
      setHasOrdersAccessDenied(data.status === "access_denied");
      setAuthMessage(data.message || null);
      setWebhookUrl(data.webhookUrl || null);
      setWebhookStatus(data.webhookStatus || { status: "unknown", lastReceivedAt: null });

      // If we just detected disconnection while user thought they were connected
      if (!data.isConnected && data.needsReconnect) {
        setFetchedCount(null);
      }
    } catch (err) {
      setWebhookStatus({ status: "unknown", lastReceivedAt: null });
      console.error("Failed to check auth status", err);
    } finally {
      if (showLoading) setIsCheckingAuth(false);
    }
  }, []);

  useEffect(() => {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" });
    const today = formatter.format(new Date());
    setDateFrom(today);
    setDateTo(today);
    checkAuthStatus(true);
    
    // Check for success/error from OAuth redirect in URL
    const urlParams = new URLSearchParams(window.location.search);
    const oauthError = urlParams.get("error");
    if (oauthError) {
      setError(getOAuthErrorMessage(oauthError));
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get("success")) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Start polling for auth status
    pollTimerRef.current = setInterval(() => {
      checkAuthStatus(false);
    }, AUTH_POLL_INTERVAL);
    const onFocus = () => { void checkAuthStatus(false); };
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [checkAuthStatus]);

  const handleFetch = async () => {
    if (disabled || isLoading) return;
    if (!isValidDateRange(dateFrom, dateTo)) {
      setError("Informe um período válido de até 31 dias.");
      return;
    }
    setIsLoading(true);
    setError(null);
    onFetchStart();
    const controller = new AbortController();
    fetchController.current = controller;

    try {
      const collected = new Map<number, OlistOrder>();
      let cursor: { day: number; offset: number } | null = null;
      let mapping: ReconciliationConfig | null = null;
      let retries = 0;
      do {
      controller.signal.throwIfAborted();
      const response: Response = await fetch("/api/olist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom,
          dateTo,
          dateMode,
          cursor: cursor || undefined,
        }),
        signal: controller.signal,
      });

      const data: { orders: OlistOrder[]; nextCursor: { day: number; offset: number } | null; mapping: ReconciliationConfig | null; error?: string; retryAfterSeconds?: number; needsReconnect?: boolean } = await response.json().catch(() => ({}));
      if (response.status === 429 && retries++ < 5) {
        const delay = Math.min(300, Math.max(1, Number(data.retryAfterSeconds) || 60));
        setError(`Limite de consultas. Retomando em ${delay} segundos…`);
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
        continue;
      }

      if (!response.ok) {
        // Check if the API is telling us we need to reconnect
        if (response.status === 401 || data.needsReconnect) {
          setIsConnected(false);
          setNeedsReconnect(true);
          setHasOrdersAccessDenied(false);
          setAuthMessage(data.error || "Sessão expirada. Reconecte sua conta.");
          setFetchedCount(null);
          return;
        }
        throw new Error(
          data.error || `Erro ${response.status}: ${response.statusText}`
        );
      }

      retries = 0;
      setError(null);
      for (const order of data.orders as OlistOrder[]) collected.set(order.id, order);
      setFetchedCount(collected.size);
      mapping = data.mapping;
      cursor = data.nextCursor;
      if (cursor) await new Promise(resolve => setTimeout(resolve, 2100));
      } while (cursor || retries > 0);
      if (!controller.signal.aborted) onFetch([...collected.values()], dateMode, mapping);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Erro ao buscar pedidos");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = () => {
    setError(null);
    setIsConnecting(true);
    window.location.assign(`/api/auth/login?t=${Date.now()}`);
  };

  const handleDisconnect = async () => {
    setError(null);
    setIsDisconnecting(true);

    try {
      const response = await fetch("/api/auth/disconnect", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível remover a conexão Tiny.");

      setIsConnected(false);
      setNeedsReconnect(false);
      setHasOrdersAccessDenied(false);
      setAuthMessage(null);
      setFetchedCount(null);
      setWebhookUrl(null);
      setWebhookStatus({ status: "unknown", lastReceivedAt: null });
      setShowWebhookConfig(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível remover a conexão Tiny.");
    } finally {
      setIsDisconnecting(false);
    }
  };

  const copyWebhookUrl = async () => {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      window.setTimeout(() => setCopiedWebhook(false), 2_000);
    } catch {
      setError("Não foi possível copiar a URL. Copie manualmente pelo navegador.");
    }
  };

  // Show reconnection UI when session expired
  const showReconnect = !isConnected && needsReconnect;
  const showAccessDenied = !isConnected && hasOrdersAccessDenied;

  return (
    <section className="card p-5 sm:p-6 lg:p-8 flex flex-col h-full min-h-[380px]">
      <div className="flex items-center gap-4 mb-7">
        <div className="w-14 h-14 p-3 rounded-[var(--radius-lg)] bg-[var(--color-accent-blue)]/10 flex items-center justify-center shrink-0">
          <Cloud className="w-7 h-7 text-[var(--color-accent-blue)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-[18px] font-semibold tracking-tight text-[var(--color-text-primary)] flex flex-wrap items-center gap-2">
            Pedidos Olist
            {isCheckingAuth ? (
               <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-tertiary)]" />
            ) : isConnected ? (
              <span className="badge badge-checked bg-[var(--color-accent-green)]/10 text-[var(--color-accent-green)] px-2.5 py-1 text-[11px]">Conectado</span>
            ) : needsReconnect ? (
              <span className="badge badge-error bg-[var(--color-accent-orange,#f59e0b)]/10 text-[var(--color-accent-orange,#f59e0b)] px-2.5 py-1 text-[11px]">Sessão Expirada</span>
            ) : hasOrdersAccessDenied ? (
              <span className="badge badge-error bg-[var(--color-accent-red)]/10 text-[var(--color-accent-red)] px-2.5 py-1 text-[11px]">Acesso negado</span>
            ) : (
              <span className="badge badge-error bg-[var(--color-accent-red)]/10 text-[var(--color-accent-red)] px-2.5 py-1 text-[11px]">Desconectado</span>
            )}
          </h3>
          <p className="text-[14px] text-[var(--color-text-tertiary)] mt-1">
            {dateMode === "updated"
              ? "Pedidos Nuvemshop alterados no período"
              : "Pedidos Nuvemshop por data de criação"}
          </p>
        </div>
      </div>

      {isCheckingAuth ? (
        <div className="flex-1 flex items-center justify-center">
           <Loader2 className="w-6 h-6 animate-spin text-[var(--color-accent-blue)]" />
        </div>
      ) : showReconnect ? (
        /* Session expired — show reconnection UI */
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-center mb-8">
            <RefreshCw className="w-10 h-10 text-[var(--color-accent-orange,#f59e0b)] mx-auto mb-4 opacity-70" />
            <p className="text-[15px] text-[var(--color-text-secondary)] mb-2">
              {authMessage || "Sua sessão com o Tiny ERP expirou."}
            </p>
            <p className="text-[13px] text-[var(--color-text-tertiary)]">
              Reconecte para continuar buscando pedidos.
            </p>
          </div>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="btn-primary w-full shadow-md hover:shadow-lg transition-shadow mt-auto py-3 text-[15px]"
          >
            {isConnecting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            {isConnecting ? "Redirecionando..." : "Reconectar Tiny ERP"}
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isDisconnecting || isConnecting}
            className="btn-ghost mt-3 w-full py-2.5 text-sm text-[var(--color-text-secondary)]"
          >
            {isDisconnecting ? "Removendo conexão..." : "Remover conexão"}
          </button>
          
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-2 mt-4 p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-red)]/8"
              >
                <AlertCircle className="w-4 h-4 text-[var(--color-accent-red)] flex-shrink-0" />
                <p className="text-[13px] text-[var(--color-accent-red)]">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : showAccessDenied ? (
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-center mb-8">
            <AlertCircle className="w-10 h-10 text-[var(--color-accent-red)] mx-auto mb-4 opacity-70" />
            <p className="text-[15px] text-[var(--color-text-secondary)] mb-2">
              {authMessage}
            </p>
            <p className="text-[13px] text-[var(--color-text-tertiary)]">
              A conexão foi salva. Autentique outra conta ou remova esta conexão para tentar novamente.
            </p>
          </div>
          <button
            onClick={handleConnect}
            disabled={isConnecting}
            className="btn-primary w-full shadow-md hover:shadow-lg transition-shadow mt-auto py-3 text-[15px]"
          >
            {isConnecting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
            {isConnecting ? "Redirecionando..." : "Autenticar outra conta Olist"}
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isDisconnecting || isConnecting}
            className="btn-ghost mt-3 w-full py-2.5 text-sm text-[var(--color-text-secondary)]"
          >
            {isDisconnecting ? "Removendo conexão..." : "Remover conexão"}
          </button>
        </div>
      ) : !isConnected ? (
        /* Not connected at all — first-time connection */
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-center mb-8">
            <LinkIcon className="w-10 h-10 text-[var(--color-text-tertiary)] mx-auto mb-4 opacity-50" />
            <p className="text-[15px] text-[var(--color-text-secondary)]">
              Conecte sua conta do Tiny ERP para <br/>buscar os pedidos automaticamente.
            </p>
          </div>
          <button
            onClick={handleConnect}
            className="btn-primary w-full shadow-md hover:shadow-lg transition-shadow mt-auto py-3 text-[15px]"
          >
            Conectar Tiny ERP
            <ExternalLink className="w-4 h-4 ml-1" />
          </button>
          
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="flex items-center gap-2 mt-4 p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-red)]/8"
              >
                <AlertCircle className="w-4 h-4 text-[var(--color-accent-red)] flex-shrink-0" />
                <p className="text-[13px] text-[var(--color-accent-red)]">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        /* Connected — show fetch UI */
        <div className="flex-1 flex flex-col justify-between">
          <div className="mb-5">
            <label className="text-[13px] font-medium text-[var(--color-text-secondary)] mb-2 block">
              Critério de busca
            </label>
            <select
              value={dateMode}
              onChange={(event) => setDateMode(event.target.value as "created" | "updated")}
              className="w-full px-3.5 py-3 rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] text-[14px] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/30 focus:border-[var(--color-accent-blue)] transition-all"
            >
              <option value="updated">Liberados ou alterados no período (recomendado)</option>
              <option value="created">Criados no período</option>
            </select>
            <p className="text-[12px] text-[var(--color-text-tertiary)] mt-2">
              {dateMode === "updated"
                ? "Inclui boletos compensados após a criação, quando o pedido é atualizado na Olist."
                : "Use apenas para localizar vendas pela data original de criação."}
            </p>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5 mb-6">
            <div>
              <label className="text-[13px] font-medium text-[var(--color-text-secondary)] mb-2 block">
                Data Início
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={dateFrom}
                  max={dateTo || undefined}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] text-[14px] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/30 focus:border-[var(--color-accent-blue)] transition-all"
                />
              </div>
            </div>
            <div>
              <label className="text-[13px] font-medium text-[var(--color-text-secondary)] mb-2 block">
                Data Fim
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={dateTo}
                  min={dateFrom || undefined}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3.5 py-3 rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] text-[14px] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/30 focus:border-[var(--color-accent-blue)] transition-all"
                />
              </div>
            </div>
          </div>

          <div>
            {/* Fetch Button */}
            <button
              onClick={handleFetch}
              disabled={disabled || isLoading || !dateFrom || !dateTo}
              className="btn-primary w-full mt-auto py-3 text-[15px]"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Buscando pedidos...
                </>
              ) : fetchedCount !== null ? (
                <>
                  <Check className="w-4 h-4" />
                  {fetchedCount} pedidos carregados — Buscar novamente
                </>
              ) : (
                <>
                  <Cloud className="w-4 h-4" />
                  Buscar Pedidos
                </>
              )}
            </button>

            {/* Error */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2 mt-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-red)]/8"
                >
                  <AlertCircle className="w-4 h-4 text-[var(--color-accent-red)] flex-shrink-0" />
                  <p className="text-[13px] text-[var(--color-accent-red)]">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Fetched success */}
            <AnimatePresence>
              {fetchedCount !== null && !error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="flex items-center gap-2 mt-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-green)]/8"
                >
                  <Check className="w-4 h-4 text-[var(--color-accent-green)] flex-shrink-0" />
                  <p className="text-[13px] text-[var(--color-accent-green)]">
                    {fetchedCount} pedidos carregados com sucesso
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {webhookUrl && (
              <div className={`mt-4 p-3.5 rounded-[var(--radius-md)] border ${webhookStatus.status === "active"
                ? "bg-[var(--color-accent-green)]/10 border-[var(--color-accent-green)]/25"
                : "bg-[var(--color-accent-yellow)]/10 border-[var(--color-accent-yellow)]/25"}`}>
                <div className="flex items-center justify-between gap-3">
                  <p role="status" className="text-[12px] font-semibold text-[var(--color-text-primary)]">
                    {webhookStatus.status === "active" ? "Webhook ativo" : webhookStatus.status === "pending" ? "Aguardando primeira notificação" : "Status do webhook indisponível"}
                  </p>
                  <button type="button" onClick={() => setShowWebhookConfig(value => !value)} aria-expanded={showWebhookConfig} aria-controls="olist-webhook-config" className="btn-ghost px-2 py-1 min-h-0 text-[12px]">
                    {showWebhookConfig ? "Fechar" : "Configurar"}
                  </button>
                </div>
                <p className="text-[12px] text-[var(--color-text-secondary)] mt-1">
                  {webhookStatus.status === "active" && webhookStatus.lastReceivedAt
                    ? <>Última notificação recebida: <time dateTime={webhookStatus.lastReceivedAt}>{new Date(webhookStatus.lastReceivedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</time> (Brasília).</>
                    : webhookStatus.status === "pending"
                      ? "Se já cadastrou a URL na Olist, aguarde a criação ou alteração de um pedido para confirmar o recebimento."
                      : "Não foi possível consultar o recebimento de notificações. Tente verificar novamente."}
                </p>
                {showWebhookConfig && <div id="olist-webhook-config" className="mt-3 space-y-2">
                  <p className="text-[12px] text-[var(--color-text-secondary)]">Cadastre esta URL em Notificações de vendas nos Webhooks da Olist para atualizar os pedidos automaticamente.</p>
                  <label className="block text-[12px] text-[var(--color-text-secondary)]">URL do webhook
                    <input readOnly value={webhookUrl} onFocus={event => event.currentTarget.select()} className="field mt-1 w-full text-[12px]" />
                  </label>
                  <button type="button" onClick={copyWebhookUrl} className="btn-ghost px-0 py-1.5 min-h-0 text-[12px]">
                    {copiedWebhook ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedWebhook ? "URL copiada" : "Copiar URL do webhook"}
                  </button>
                </div>}
                <button type="button" disabled={isCheckingWebhook} onClick={async () => {
                  setIsCheckingWebhook(true);
                  try { await checkAuthStatus(); } finally { setIsCheckingWebhook(false); }
                }} className="btn-ghost px-0 py-1.5 min-h-0 text-[12px] mt-1.5">
                  <RefreshCw className={`w-3.5 h-3.5 ${isCheckingWebhook ? "animate-spin" : ""}`} />
                  {isCheckingWebhook ? "Verificando…" : "Verificar status"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
