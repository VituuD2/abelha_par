"use client";

import { useState, useCallback, useRef } from "react";
import { Header } from "@/components/layout/header";
import { UploadCard } from "@/components/dashboard/upload-card";
import { ApiFetchCard } from "@/components/dashboard/api-fetch-card";
import { MatchSummary } from "@/components/dashboard/match-summary";
import { matchOrders, getUnmatchedOrders, getMissingFromOlist } from "@/lib/matcher";
import { useScanStore } from "@/stores/scan-store";
import type { OlistOrder, ScanOrder } from "@/types";
import { motion } from "framer-motion";
import { Package, ArrowDownUp } from "lucide-react";

export default function DashboardPage() {
  const [yampiIds, setYampiIds] = useState<Set<string> | null>(null);
  const [yampiFileName, setYampiFileName] = useState<string>("");
  const [olistOrders, setOlistOrders] = useState<OlistOrder[]>([]);
  const [matchedOrders, setMatchedOrders] = useState<ScanOrder[]>([]);
  const [unmatchedOrders, setUnmatchedOrders] = useState<OlistOrder[]>([]);
  const [missingFromOlist, setMissingFromOlist] = useState<string[]>([]);
  const [isResolving, setIsResolving] = useState(false);
  const [resolvedCount, setResolvedCount] = useState(0);
  const [resolutionError, setResolutionError] = useState<string | null>(null);
  const resolutionIdRef = useRef(0);
  const setStoreOrders = useScanStore((state) => state.setOrders);

  const runCrossReference = useCallback(
    (orders: OlistOrder[], ids: Set<string>) => {
      const matched = matchOrders(orders, ids);
      const unmatched = getUnmatchedOrders(orders, ids);
      const missing = getMissingFromOlist(orders, ids);
      setMatchedOrders(matched);
      setUnmatchedOrders(unmatched);
      setMissingFromOlist(missing);
    },
    []
  );

  const resolveAndCrossReference = useCallback(
    async (orders: OlistOrder[], ids: Set<string>) => {
      const resolutionId = ++resolutionIdRef.current;
      setIsResolving(true);
      setResolvedCount(0);
      setResolutionError(null);
      setMatchedOrders([]);
      setUnmatchedOrders([]);
      setMissingFromOlist([]);

      try {
        const resolvedOrders: OlistOrder[] = [];
        let start = 0;
        while (start < orders.length) {
          const batch = orders.slice(start, start + 10);
          const response = await fetch("/api/olist/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderIds: batch.map((order) => order.id) }),
          });
          const payload = await response.json().catch(() => ({}));
          if (response.status === 429) {
            const retryAfterSeconds = Math.max(1, Number(payload.retryAfterSeconds) || 60);
            setResolutionError(`A Tiny atingiu o limite. Retomando automaticamente em ${retryAfterSeconds} segundos...`);
            await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
            if (resolutionId !== resolutionIdRef.current) return;
            setResolutionError(null);
            continue;
          }
          if (!response.ok) throw new Error(payload.error || "Não foi possível consultar os detalhes na Tiny.");
          if (resolutionId !== resolutionIdRef.current) return;
          resolvedOrders.push(...payload.orders);
          setResolvedCount(resolvedOrders.length);
          start += batch.length;
        }

        if (resolutionId !== resolutionIdRef.current) return;
        setOlistOrders(resolvedOrders);
        runCrossReference(resolvedOrders, ids);
      } catch (error) {
        if (resolutionId === resolutionIdRef.current) {
          setResolutionError(error instanceof Error ? error.message : "Não foi possível cruzar os pedidos.");
        }
      } finally {
        if (resolutionId === resolutionIdRef.current) setIsResolving(false);
      }
    },
    [runCrossReference]
  );

  const handleUpload = useCallback(
    (ids: Set<string>, fileName: string) => {
      setYampiIds(ids);
      setYampiFileName(fileName);
      if (olistOrders.length > 0) {
        void resolveAndCrossReference(olistOrders, ids);
      }
    },
    [olistOrders, resolveAndCrossReference]
  );

  const handleClearUpload = useCallback(() => {
    resolutionIdRef.current += 1;
    setYampiIds(null);
    setYampiFileName("");
    setMatchedOrders([]);
    setUnmatchedOrders([]);
    setMissingFromOlist([]);
    setIsResolving(false);
    setResolutionError(null);
  }, []);

  const handleFetch = useCallback(
    (orders: OlistOrder[]) => {
      setOlistOrders(orders);
      if (yampiIds) {
        void resolveAndCrossReference(orders, yampiIds);
      }
    },
    [yampiIds, resolveAndCrossReference]
  );

  const handleStartScanning = useCallback(() => {
    setStoreOrders(matchedOrders);
  }, [matchedOrders, setStoreOrders]);

  const bothLoaded = yampiIds !== null && olistOrders.length > 0;

  return (
    <>
      <Header
        title="Abelha Par - Dashboard"
        subtitle="Carregue os dados para iniciar a conferência de pedidos"
        breadcrumbs={["Abelha Par", "Dashboard"]}
      />

      {/* Hero Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="card p-6 sm:p-8 mb-8 sm:mb-10 overflow-hidden relative"
      >
        <div className="absolute -right-10 -top-16 w-44 h-44 rounded-full bg-[var(--color-accent-yellow)]/15 blur-2xl pointer-events-none" />
        <div className="relative flex items-center gap-4 sm:gap-6">
          <div className="w-14 h-14 sm:w-[72px] sm:h-[72px] p-3 sm:p-4 rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--color-accent-yellow)] to-[var(--color-accent-blue)] flex items-center justify-center shadow-lg shrink-0">
            <Package className="w-8 h-8 sm:w-10 sm:h-10 text-white" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--color-accent-blue)] mb-1">Central de conferência</p>
            <h2 className="text-[20px] font-bold text-[var(--color-text-primary)] tracking-tight">
              Dashboard
            </h2>
            <p className="text-[14px] text-[var(--color-text-secondary)] mt-1">
              {bothLoaded
                ? `${olistOrders.length} pedidos Olist × ${yampiIds.size} IDs Yampi carregados`
                : "Carregue os pedidos da API e a planilha Yampi para cruzar os dados"}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 xl:gap-6 mb-8 sm:mb-10">
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <ApiFetchCard onFetch={handleFetch} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3, delay: 0.2 }}
        >
          <UploadCard onUpload={handleUpload} onClear={handleClearUpload} />
        </motion.div>
      </div>

      {/* Cross-reference indicator */}
      {!bothLoaded && (yampiIds !== null || olistOrders.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-3 p-6 sm:p-8 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)]/70 border border-dashed border-[var(--color-border-medium)] mb-10 text-center"
        >
          <ArrowDownUp className="w-5 h-5 text-[var(--color-text-tertiary)] animate-pulse-slow" />
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            {yampiIds !== null
              ? "Agora busque os pedidos na API para cruzar os dados"
              : "Agora faça upload da planilha Yampi para cruzar os dados"}
          </p>
        </motion.div>
      )}

      {/* Match Summary */}
      {bothLoaded && isResolving && (
        <div className="flex items-center justify-center gap-3 p-6 rounded-[var(--radius-lg)] bg-[var(--color-bg-secondary)]/70 border border-dashed border-[var(--color-border-medium)] text-center">
          <div className="w-5 h-5 border-2 border-[var(--color-accent-blue)] border-t-transparent rounded-full animate-spin" />
          <p className="text-[14px] text-[var(--color-text-secondary)]">
            {resolutionError || `Consultando observações internas na Tiny: ${resolvedCount} de ${olistOrders.length} pedidos`}
          </p>
        </div>
      )}

      {bothLoaded && resolutionError && !isResolving && (
        <div role="alert" className="p-5 rounded-[var(--radius-lg)] bg-[var(--color-accent-red)]/10 text-[var(--color-accent-red)]">
          {resolutionError} Tente buscar os pedidos novamente.
        </div>
      )}

      {bothLoaded && !isResolving && !resolutionError && (
        <MatchSummary
          matchedOrders={matchedOrders}
          unmatchedOrders={unmatchedOrders}
          missingFromOlist={missingFromOlist}
          onStartScanning={handleStartScanning}
        />
      )}
    </>
  );
}
