"use client";

import { useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { PartyPopper, Save, RotateCcw } from "lucide-react";
import confetti from "canvas-confetti";
import { useScanStore } from "@/stores/scan-store";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function Completion() {
  const orders = useScanStore((state) => state.orders);
  const reset = useScanStore((state) => state.reset);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  // Fire confetti
  useEffect(() => {
    const duration = 3000;
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: 3,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ["#34C759", "#007AFF", "#AF52DE", "#FFCC00"],
      });
      confetti({
        particleCount: 3,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ["#34C759", "#007AFF", "#AF52DE", "#FFCC00"],
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };

    frame();
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("lotes_bipagem").insert({
        data: new Date().toISOString().split("T")[0],
        qtd_pedidos: orders.length,
        pedidos: orders.map((o) => ({
          olistId: o.id,
          yampiId: o.yampiId,
          trackingCode: o.trackingCode,
          clientName: o.clientName,
          scannedAt: o.scannedAt,
        })),
      });

      if (error) {
        console.error("Supabase save error:", error);
        alert(`Erro ao salvar: ${error.message}`);
      } else {
        setSaved(true);
      }
    } catch (err) {
      console.error("Save error:", err);
      alert("Erro ao salvar lote. Verifique a conexão com o Supabase.");
    } finally {
      setIsSaving(false);
    }
  }, [orders]);

  const handleNewBatch = useCallback(() => {
    reset();
    router.push("/");
  }, [reset, router]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 300, damping: 25 }}
      className="fixed inset-0 z-[150] flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-white/80 backdrop-blur-xl" />

      <div className="relative w-full max-w-sm text-center">
        <motion.div
          initial={{ scale: 0, rotate: -10 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", stiffness: 400, delay: 0.2 }}
          className="w-20 h-20 rounded-full bg-gradient-to-br from-[var(--color-accent-green)] to-[var(--color-accent-blue)] flex items-center justify-center mx-auto mb-5 shadow-xl"
        >
          <PartyPopper className="w-10 h-10 text-white" />
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="text-[28px] font-bold text-[var(--color-text-primary)] mb-2"
        >
          Bipagem Completa! 🎉
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-[15px] text-[var(--color-text-secondary)] mb-8"
        >
          Todos os {orders.length} pedidos foram conferidos com sucesso.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="space-y-3"
        >
          {!saved ? (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="btn-success w-full py-3 text-[16px]"
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Salvar Lote
                </>
              )}
            </button>
          ) : (
            <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-accent-green)]/10 border border-[var(--color-accent-green)]/20">
              <p className="text-[15px] font-semibold text-[var(--color-accent-green)]">
                ✓ Lote salvo com sucesso!
              </p>
            </div>
          )}

          <button onClick={handleNewBatch} className="btn-ghost w-full">
            <RotateCcw className="w-4 h-4" />
            Novo Lote
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
}
