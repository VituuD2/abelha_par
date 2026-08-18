"use client";

import { ScanBarcode, ArrowRight, AlertTriangle, CheckCircle2, UserRound } from "lucide-react";
import { motion } from "framer-motion";
import type { ScanOrder, OlistOrder } from "@/types";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { normalizeResponsible } from "@/lib/responsible";

interface MatchSummaryProps {
  matchedOrders: ScanOrder[];
  unmatchedOrders: OlistOrder[];
  missingFromOlist: string[];
  onStartScanning: (responsible: string) => void;
}

export function MatchSummary({
  matchedOrders,
  unmatchedOrders,
  missingFromOlist,
  onStartScanning,
}: MatchSummaryProps) {
  const router = useRouter();
  const [responsible, setResponsible] = useState("");
  const hasIssues = unmatchedOrders.length > 0 || missingFromOlist.length > 0;
  const normalizedResponsible = normalizeResponsible(responsible);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
      className="card-elevated p-5 sm:p-6"
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="text-center p-3.5 rounded-[var(--radius-md)] bg-[var(--color-accent-green)]/8">
          <p className="text-[24px] font-bold text-[var(--color-accent-green)]">
            {matchedOrders.length}
          </p>
          <p className="text-[11px] font-medium text-[var(--color-text-secondary)] mt-0.5">
            Pedidos Conferir
          </p>
        </div>
        <div className="text-center p-3.5 rounded-[var(--radius-md)] bg-[var(--color-accent-orange)]/8">
          <p className="text-[24px] font-bold text-[var(--color-accent-orange)]">
            {unmatchedOrders.length}
          </p>
          <p className="text-[11px] font-medium text-[var(--color-text-secondary)] mt-0.5">
            Sem Match Olist
          </p>
        </div>
        <div className="text-center p-3.5 rounded-[var(--radius-md)] bg-[var(--color-accent-red)]/8">
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

      <div className="mb-3">
        <label htmlFor="batch-responsible" className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-[var(--color-text-primary)]">
          <UserRound className="w-4 h-4 text-[var(--color-accent-blue)]" />
          Responsável
        </label>
        <input
          id="batch-responsible"
          value={responsible}
          onChange={(event) => setResponsible(event.target.value)}
          placeholder="Digite o nome do responsável"
          autoComplete="name"
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-primary)] px-3 py-2.5 text-[14px] text-[var(--color-text-primary)] outline-none transition-colors placeholder:text-[var(--color-text-tertiary)] focus:border-[var(--color-accent-blue)]"
          aria-invalid={responsible.length > 0 && !normalizedResponsible}
        />
        {responsible.length > 0 && !normalizedResponsible && (
          <p className="mt-1.5 text-[12px] text-[var(--color-accent-red)]">Informe um nome válido, com pelo menos 3 letras.</p>
        )}
      </div>

      {/* Start Scanning Button */}
      <button
        className="btn-success w-full text-[16px] py-3"
        disabled={matchedOrders.length === 0 || !normalizedResponsible}
        onClick={() => {
          if (!normalizedResponsible) return;
          onStartScanning(normalizedResponsible);
          router.push("/scanner");
        }}
      >
          <ScanBarcode className="w-5 h-5" />
          Iniciar Bipagem ({matchedOrders.length} pedidos)
          <ArrowRight className="w-4 h-4" />
      </button>
    </motion.div>
  );
}
