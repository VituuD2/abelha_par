"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/layout/header";
import { BatchTable } from "@/components/history/batch-table";
import { createClient } from "@/lib/supabase/client";
import type { Batch } from "@/types";
import { motion } from "framer-motion";
import { Clock, RefreshCw } from "lucide-react";

export default function HistoryPage() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBatches = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data, error: fetchError } = await supabase
        .from("lotes_bipagem")
        .select("*")
        .order("created_at", { ascending: false });

      if (fetchError) {
        throw fetchError;
      }

      setBatches(data || []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Erro ao carregar histórico. Verifique a conexão com o Supabase."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchBatches();
  }, []);

  return (
    <>
      <Header
        title="Histórico"
        subtitle="Lotes de bipagem salvos"
        breadcrumbs={["Scanner Checkout", "Histórico"]}
      />

      {/* Refresh Button */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between mb-4"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-accent-blue)]/10 flex items-center justify-center">
            <Clock className="w-5 h-5 text-[var(--color-accent-blue)]" />
          </div>
          <div>
            <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">
              {batches.length} lote{batches.length !== 1 ? "s" : ""} registrado
              {batches.length !== 1 ? "s" : ""}
            </p>
            <p className="text-[12px] text-[var(--color-text-tertiary)]">
              Dados salvos no Supabase
            </p>
          </div>
        </div>
        <button
          onClick={fetchBatches}
          disabled={isLoading}
          className="btn-ghost text-[13px]"
        >
          <RefreshCw
            className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`}
          />
          Atualizar
        </button>
      </motion.div>

      {/* Content */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-16 w-full" />
          ))}
        </div>
      ) : error ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="card p-8 text-center"
        >
          <p className="text-[14px] text-[var(--color-accent-red)] mb-3">
            {error}
          </p>
          <button onClick={fetchBatches} className="btn-primary">
            Tentar novamente
          </button>
        </motion.div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <BatchTable batches={batches} />
        </motion.div>
      )}
    </>
  );
}
