"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Package, Calendar, Hash, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Batch } from "@/types";
import { motion, AnimatePresence } from "framer-motion";

interface BatchTableProps {
  batches: Batch[];
}

export function BatchTable({ batches }: BatchTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (batches.length === 0) {
    return (
      <div className="card p-12 text-center">
        <div className="w-16 h-16 rounded-full bg-[var(--color-bg-primary)] flex items-center justify-center mx-auto mb-4">
          <Package className="w-8 h-8 text-[var(--color-text-tertiary)]" />
        </div>
        <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)] mb-1">
          Nenhum lote registrado
        </h3>
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Complete uma sessão de bipagem para ver o histórico aqui.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {batches.map((batch, index) => {
        const isExpanded = expandedId === batch.id;
        const formattedDate = new Date(batch.created_at).toLocaleDateString(
          "pt-BR",
          {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }
        );

        return (
          <motion.div
            key={batch.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="card overflow-hidden"
          >
            {/* Row Header */}
            <button
              onClick={() =>
                setExpandedId(isExpanded ? null : batch.id)
              }
              className="w-full flex items-center gap-3 p-4 text-left hover:bg-black/[0.02] transition-colors"
            >
              <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-accent-green)]/10 flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-5 h-5 text-[var(--color-accent-green)]" />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-semibold text-[var(--color-text-primary)]">
                    Lote #{batch.numero_lote}
                  </p>
                  <span className="badge badge-checked">Completo ✓</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="flex items-center gap-1 text-[12px] text-[var(--color-text-tertiary)]">
                    <Calendar className="w-3 h-3" />
                    {formattedDate}
                  </span>
                  <span className="flex items-center gap-1 text-[12px] text-[var(--color-text-tertiary)]">
                    <Hash className="w-3 h-3" />
                    {batch.qtd_pedidos} pedidos
                  </span>
                </div>
              </div>

              {isExpanded ? (
                <ChevronUp className="w-5 h-5 text-[var(--color-text-tertiary)] flex-shrink-0" />
              ) : (
                <ChevronDown className="w-5 h-5 text-[var(--color-text-tertiary)] flex-shrink-0" />
              )}
            </button>

            {/* Expanded Detail */}
            <AnimatePresence>
              {isExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-4 border-t border-[var(--color-border-light)]">
                    <div className="pt-3 space-y-2">
                      {(batch.pedidos || []).map((order, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-3 p-2.5 rounded-[var(--radius-sm)] bg-[var(--color-bg-primary)]"
                        >
                          <div className="w-6 h-6 rounded-full bg-[var(--color-accent-green)]/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[10px] font-bold text-[var(--color-accent-green)]">
                              {idx + 1}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-[var(--color-text-primary)] truncate">
                              {order.clientName}
                            </p>
                            <p className="text-[11px] text-[var(--color-text-tertiary)] font-mono">
                              {order.trackingCode}
                            </p>
                          </div>
                          <span className="text-[11px] text-[var(--color-text-tertiary)]">
                            Yampi #{order.yampiId}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
