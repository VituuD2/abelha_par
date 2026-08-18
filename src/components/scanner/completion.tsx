"use client";

import { useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { PartyPopper, Save, RotateCcw, Printer } from "lucide-react";
import confetti from "canvas-confetti";
import { useScanStore } from "@/stores/scan-store";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Batch } from "@/types";

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCompletionDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function printBatch(batch: Batch) {
  const rows = batch.pedidos.map(
    (order, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(order.clientName)}</td><td class="code">${escapeHtml(order.trackingCode)}</td><td>${escapeHtml(order.yampiId)}</td></tr>`
  ).join("");
  const printFrame = document.createElement("iframe");
  printFrame.setAttribute("aria-hidden", "true");
  printFrame.style.cssText = "position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0;pointer-events:none;";
  printFrame.srcdoc = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" /><title>Abelha Par - Lote #${escapeHtml(batch.numero_lote)}</title><style>@page{size:A4;margin:16mm}body{color:#302518;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-size:12px}header{display:flex;justify-content:space-between;padding-bottom:16px;border-bottom:2px solid #d97706}h1{margin:0;font-size:23px}p{margin:5px 0 0;color:#6f6252}.summary{display:flex;gap:28px;margin:18px 0;padding:13px 15px;background:#fffaf1;border:1px solid #f0ddbd;border-radius:10px}.summary strong{display:block;margin-top:3px;font-size:14px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{padding:10px 8px;border-bottom:1px solid #eadfce;text-align:left}th{color:#6f6252;font-size:10px;text-transform:uppercase}.code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}</style></head><body><header><div><h1>Abelha Par</h1><p>Resultado da conferência de pedidos</p></div><strong>Lote #${escapeHtml(batch.numero_lote)}</strong></header><section class="summary"><div>Lote finalizado em<strong>${escapeHtml(formatCompletionDate(batch.created_at))}</strong></div><div>Pedidos conferidos<strong>${escapeHtml(batch.qtd_pedidos)}</strong></div></section><table><thead><tr><th>#</th><th>Cliente</th><th>Rastreio</th><th>ID Yampi</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
  printFrame.srcdoc = printFrame.srcdoc.replace(
    '<section class="summary">',
    `<section class="summary"><div>Responsável<strong>${escapeHtml(batch.responsavel)}</strong></div>`
  );
  printFrame.onload = () => {
    printFrame.contentWindow?.focus();
    printFrame.contentWindow?.print();
    window.setTimeout(() => printFrame.remove(), 60_000);
  };
  document.body.appendChild(printFrame);
}

export function Completion() {
  const orders = useScanStore((state) => state.orders);
  const responsible = useScanStore((state) => state.responsible);
  const reset = useScanStore((state) => state.reset);
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedBatch, setSavedBatch] = useState<Batch | null>(null);
  const router = useRouter();

  // Fire confetti
  useEffect(() => {
    const duration = 3000;
    const end = Date.now() + duration;
    let frameId: number | undefined;
    let cancelled = false;

    const frame = () => {
      if (cancelled) return;
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
        frameId = requestAnimationFrame(frame);
      }
    };

    frame();
    return () => {
      cancelled = true;
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const response = await fetch("/api/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orders, responsible }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.batch) throw new Error("Não foi possível salvar o lote.");
      setSavedBatch(payload.batch as Batch);
      setSaved(true);
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
            <>
              <div className="p-4 rounded-[var(--radius-lg)] bg-[var(--color-accent-green)]/10 border border-[var(--color-accent-green)]/20">
                <p className="text-[15px] font-semibold text-[var(--color-accent-green)]">
                  ✓ Lote salvo com sucesso!
                </p>
              </div>
              <button
                type="button"
                onClick={() => savedBatch && printBatch(savedBatch)}
                disabled={!savedBatch}
                className="btn-primary w-full py-3 text-[16px]"
              >
                <Printer className="w-5 h-5" />
                Imprimir resultado
              </button>
            </>
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
