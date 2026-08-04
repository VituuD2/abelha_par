"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Package, Calendar, Hash, CheckCircle2, Printer } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Batch } from "@/types";
import { motion, AnimatePresence } from "framer-motion";

interface BatchTableProps {
  batches: Batch[];
}

function formatOrderDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

function escapeHtml(value: string | number | null | undefined) {
  return String(value ?? "—")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatBatchDate(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function printBatch(batch: Batch) {
  const rows = (batch.pedidos || [])
    .map((order, index) => {
      const saleDate = formatOrderDate(order.dataCriacao);
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(order.clientName)}</td>
        <td class="code">${escapeHtml(order.trackingCode)}</td>
        <td>${escapeHtml(order.yampiId)}</td>
        <td>${escapeHtml(saleDate)}</td>
      </tr>`;
    })
    .join("");

  const printDocument = `<!doctype html>
    <html lang="pt-BR">
      <head>
        <meta charset="utf-8" />
        <title>Abelha Par - Lote #${batch.numero_lote}</title>
        <style>
          @page { size: A4; margin: 16mm; }
          * { box-sizing: border-box; }
          body { color: #302518; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; }
          header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 16px; border-bottom: 2px solid #d97706; }
          h1 { margin: 0; font-size: 23px; letter-spacing: -0.03em; }
          h2 { margin: 5px 0 0; color: #6f6252; font-size: 13px; font-weight: 500; }
          .badge { border-radius: 999px; background: #fff1d6; color: #9a5700; padding: 6px 10px; font-weight: 700; }
          .summary { display: flex; gap: 28px; margin: 18px 0; padding: 13px 15px; background: #fffaf1; border: 1px solid #f0ddbd; border-radius: 10px; }
          .summary strong { display: block; margin-top: 3px; font-size: 14px; }
          table { width: 100%; border-collapse: collapse; }
          th { color: #6f6252; font-size: 10px; letter-spacing: .05em; text-align: left; text-transform: uppercase; }
          th, td { padding: 10px 8px; border-bottom: 1px solid #eadfce; vertical-align: top; }
          td:first-child { color: #978977; width: 32px; }
          .code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; }
          footer { margin-top: 18px; color: #978977; font-size: 10px; }
        </style>
      </head>
      <body>
        <header>
          <div>
            <h1>Abelha Par</h1>
            <h2>Resultado da conferência de pedidos</h2>
          </div>
          <span class="badge">Lote #${escapeHtml(batch.numero_lote)}</span>
        </header>
        <section class="summary">
          <div>Data da bipagem<strong>${escapeHtml(formatBatchDate(batch.created_at))}</strong></div>
          <div>Pedidos conferidos<strong>${escapeHtml(batch.qtd_pedidos)}</strong></div>
        </section>
        <table>
          <thead><tr><th>#</th><th>Cliente</th><th>Rastreio</th><th>ID Yampi</th><th>Data da venda</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <footer>Documento gerado em ${escapeHtml(formatBatchDate(new Date().toISOString()))}.</footer>
      </body>
    </html>`;

  // Imprimir por um iframe evita que o navegador trate a ação como pop-up.
  const printFrame = document.createElement("iframe");
  printFrame.setAttribute("aria-hidden", "true");
  printFrame.style.cssText = "position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0;pointer-events:none;";

  const removePrintFrame = () => {
    window.setTimeout(() => printFrame.remove(), 0);
  };

  printFrame.onload = () => {
    const frameWindow = printFrame.contentWindow;
    if (!frameWindow) {
      removePrintFrame();
      window.alert("Não foi possível preparar a impressão. Tente novamente.");
      return;
    }

    frameWindow.addEventListener("afterprint", removePrintFrame, { once: true });
    frameWindow.focus();
    frameWindow.print();
    // Alguns navegadores não disparam afterprint ao cancelar a impressão.
    window.setTimeout(removePrintFrame, 60_000);
  };

  printFrame.srcdoc = printDocument;
  document.body.appendChild(printFrame);
}

export function BatchTable({ batches }: BatchTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (batches.length === 0) {
    return (
      <div className="card p-8 sm:p-12 text-center">
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
        const formattedDate = formatBatchDate(batch.created_at);

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
            className="w-full flex items-center gap-3 p-4 sm:p-5 text-left hover:bg-[var(--color-accent-yellow)]/10 transition-colors"
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
                    <div className="pt-4 flex items-center justify-between gap-3">
                      <p className="text-[12px] text-[var(--color-text-secondary)]">
                        {batch.qtd_pedidos} pedidos conferidos neste lote.
                      </p>
                      <button
                        type="button"
                        onClick={() => printBatch(batch)}
                        className="btn-primary min-h-0 px-4 py-2 text-[13px]"
                      >
                        <Printer className="w-4 h-4" />
                        Imprimir resultado
                      </button>
                    </div>
                    <div className="pt-3 space-y-2">
                      {(batch.pedidos || []).map((order, idx) => (
                        <div
                          key={`${order.id}-${order.yampiId}`}
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
                            {formatOrderDate(order.dataCriacao) && (
                              <p className="text-[11px] text-[var(--color-text-tertiary)]">
                                Venda em {formatOrderDate(order.dataCriacao)}
                              </p>
                            )}
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
