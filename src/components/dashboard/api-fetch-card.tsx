"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Cloud, Loader2, Check, AlertCircle, Link as LinkIcon, ExternalLink, RefreshCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { OlistOrder } from "@/types";

interface ApiFetchCardProps {
  onFetch: (orders: OlistOrder[]) => void;
}

// Poll auth status every 10 minutes to detect token expiration proactively
const AUTH_POLL_INTERVAL = 10 * 60 * 1000;

export function ApiFetchCard({ onFetch }: ApiFetchCardProps) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedCount, setFetchedCount] = useState<number | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkAuthStatus = useCallback(async (showLoading = false) => {
    if (showLoading) setIsCheckingAuth(true);
    try {
      const res = await fetch("/api/auth/status");
      const data = await res.json();
      
      setIsConnected(data.isConnected);
      setNeedsReconnect(data.needsReconnect || false);
      setAuthMessage(data.message || null);

      // If we just detected disconnection while user thought they were connected
      if (!data.isConnected && data.needsReconnect) {
        setError(null);
        setFetchedCount(null);
      }
    } catch (err) {
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
    if (urlParams.get("error")) {
      setError(`Erro na autenticação: ${urlParams.get("error")}`);
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get("success")) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Start polling for auth status
    pollTimerRef.current = setInterval(() => {
      checkAuthStatus(false);
    }, AUTH_POLL_INTERVAL);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
      }
    };
  }, [checkAuthStatus]);

  const handleFetch = async () => {
    if (!dateFrom || !dateTo) return;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/olist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dateFrom,
          dateTo,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Check if the API is telling us we need to reconnect
        if (response.status === 401 || data.needsReconnect) {
          setIsConnected(false);
          setNeedsReconnect(true);
          setAuthMessage(data.error || "Sessão expirada. Reconecte sua conta.");
          setFetchedCount(null);
          return;
        }
        throw new Error(
          data.error || `Erro ${response.status}: ${response.statusText}`
        );
      }

      setFetchedCount(data.orders.length);
      onFetch(data.orders);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao buscar pedidos");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = () => {
    window.location.href = `/api/auth/login?t=${Date.now()}`;
  };

  // Show reconnection UI when session expired
  const showReconnect = !isConnected && (needsReconnect || authMessage);

  return (
    <div className="card p-6 lg:p-8 flex flex-col h-full min-h-[380px]">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 p-3 rounded-[var(--radius-lg)] bg-[var(--color-accent-blue)]/10 flex items-center justify-center shrink-0">
          <Cloud className="w-7 h-7 text-[var(--color-accent-blue)]" />
        </div>
        <div className="flex-1">
          <h3 className="text-[18px] font-semibold text-[var(--color-text-primary)] flex items-center gap-3">
            Pedidos Olist
            {isCheckingAuth ? (
               <Loader2 className="w-4 h-4 animate-spin text-[var(--color-text-tertiary)]" />
            ) : isConnected ? (
              <span className="badge badge-checked bg-[var(--color-accent-green)]/10 text-[var(--color-accent-green)] px-2.5 py-1 text-[11px]">Conectado</span>
            ) : needsReconnect ? (
              <span className="badge badge-error bg-[var(--color-accent-orange,#f59e0b)]/10 text-[var(--color-accent-orange,#f59e0b)] px-2.5 py-1 text-[11px]">Sessão Expirada</span>
            ) : (
              <span className="badge badge-error bg-[var(--color-accent-red)]/10 text-[var(--color-accent-red)] px-2.5 py-1 text-[11px]">Desconectado</span>
            )}
          </h3>
          <p className="text-[14px] text-[var(--color-text-tertiary)] mt-1">
            Buscar via API Tiny ERP
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
            className="btn-primary w-full shadow-md hover:shadow-lg transition-shadow mt-auto py-3 text-[15px]"
          >
            <RefreshCw className="w-4 h-4 mr-1" />
            Reconectar Tiny ERP
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
          {/* Date Range */}
          <div className="grid grid-cols-2 gap-5 mb-8">
            <div>
              <label className="text-[13px] font-medium text-[var(--color-text-secondary)] mb-2 block">
                Data Início
              </label>
              <div className="relative">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-white text-[14px] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/30 focus:border-[var(--color-accent-blue)] transition-all"
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
                  onChange={(e) => setDateTo(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-white text-[14px] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/30 focus:border-[var(--color-accent-blue)] transition-all"
                />
              </div>
            </div>
          </div>

          <div>
            {/* Fetch Button */}
            <button
              onClick={handleFetch}
              disabled={isLoading || !dateFrom || !dateTo}
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
          </div>
        </div>
      )}
    </div>
  );
}
