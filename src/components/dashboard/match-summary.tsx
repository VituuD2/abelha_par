"use client";

import { ScanBarcode, ArrowRight, AlertTriangle, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";
import type { ScanOrder, OlistOrder } from "@/types";
import Link from "next/link";

interface MatchSummaryProps {
  matchedOrders: ScanOrder[];
  unmatchedOrders: OlistOrder[];
  missingFromOlist: string[];
  onStartScanning: () => void;
}

export function MatchSummary({
  matchedOrders,
  unmatchedOrders,
  missingFromOlist,
  onStartScanning,
}: MatchSummaryProps) {
  const hasIssues = unmatchedOrders.length > 0 || missingFromOlist.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
      className="card-elevated p-6"
    >
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-accent-green)] to-[var(--color-accent-blue)] flex items-center justify-center">
          <CheckCircle2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
            Resultado do Cruzamento
          </h3>
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Olist × Yampi
          </p>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="text-center p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-green)]/8">
          <p className="text-[24px] font-bold text-[var(--color-accent-green)]">
            {matchedOrders.length}
          </p>
          <p className="text-[11px] font-medium text-[var(--color-text-secondary)] mt-0.5">
            Pedidos Conferir
          </p>
        </div>
        <div className="text-center p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-orange)]/8">
          <p className="text-[24px] font-bold text-[var(--color-accent-orange)]">
            {unmatchedOrders.length}
          </p>
          <p className="text-[11px] font-medium text-[var(--color-text-secondary)] mt-0.5">
            Sem Match Olist
          </p>
        </div>
        <div className="text-center p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-red)]/8">
          <p className="text-[24px] font-bold text-[var(--color-accent-red)]">
            {missingFromOlist.length}
          </p>
          <p className="text-[11px] font-medium text-[var(--color-text-secondary)] mt-0.5">
            Faltam na API
          </p>
        </div>
      </div>

      {/* Warning */}
      {hasIssues && (
        <div className="flex items-start gap-2 p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-orange)]/8 mb-5">
          <AlertTriangle className="w-4 h-4 text-[var(--color-accent-orange)] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] text-[var(--color-text-primary)] font-medium">
              Existem pedidos não conciliados
            </p>
            <p className="text-[12px] text-[var(--color-text-secondary)] mt-0.5">
              Apenas os {matchedOrders.length} pedidos com match serão incluídos na bipagem.
            </p>
          </div>
        </div>
      )}

      {/* Start Scanning Button */}
      <Link href="/scanner" onClick={onStartScanning}>
        <button
          className="btn-success w-full text-[16px] py-3"
          disabled={matchedOrders.length === 0}
        >
          <ScanBarcode className="w-5 h-5" />
          Iniciar Bipagem ({matchedOrders.length} pedidos)
          <ArrowRight className="w-4 h-4" />
        </button>
      </Link>
    </motion.div>
  );
}
