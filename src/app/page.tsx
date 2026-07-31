"use client";

import { useState, useCallback } from "react";
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

  const handleUpload = useCallback(
    (ids: Set<string>, fileName: string) => {
      setYampiIds(ids);
      setYampiFileName(fileName);
      if (olistOrders.length > 0) {
        runCrossReference(olistOrders, ids);
      }
    },
    [olistOrders, runCrossReference]
  );

  const handleFetch = useCallback(
    (orders: OlistOrder[]) => {
      setOlistOrders(orders);
      if (yampiIds) {
        runCrossReference(orders, yampiIds);
      }
    },
    [yampiIds, runCrossReference]
  );

  const handleStartScanning = useCallback(() => {
    setStoreOrders(matchedOrders);
  }, [matchedOrders, setStoreOrders]);

  const bothLoaded = yampiIds !== null && olistOrders.length > 0;

  return (
    <>
      <Header
        title="Dashboard"
        subtitle="Carregue os dados para iniciar a conferência de pedidos"
        breadcrumbs={["Scanner Checkout", "Dashboard"]}
      />

      {/* Hero Stats */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="card p-8 mb-10"
      >
        <div className="flex items-center gap-6">
          <div className="w-16 h-16 rounded-[var(--radius-lg)] bg-gradient-to-br from-[var(--color-accent-blue)] to-[var(--color-accent-purple)] flex items-center justify-center shadow-lg">
            <Package className="w-8 h-8 text-white" />
          </div>
          <div>
            <h2 className="text-[20px] font-bold text-[var(--color-text-primary)]">
              Conferência de Pedidos
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
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-10">
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
          <UploadCard onUpload={handleUpload} />
        </motion.div>
      </div>

      {/* Cross-reference indicator */}
      {!bothLoaded && (yampiIds !== null || olistOrders.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-center gap-4 p-8 rounded-[var(--radius-lg)] bg-white/60 border border-dashed border-[var(--color-border-medium)] mb-10"
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
      {bothLoaded && matchedOrders.length >= 0 && (
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
