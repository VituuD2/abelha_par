"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { ScanInput } from "@/components/scanner/scan-input";
import { OrderList } from "@/components/scanner/order-list";
import { SuccessPopup } from "@/components/scanner/success-popup";
import { ErrorPopup } from "@/components/scanner/error-popup";
import { Completion } from "@/components/scanner/completion";
import { useScanner } from "@/hooks/use-scanner";
import { useTrackingRefresh } from "@/hooks/use-tracking-refresh";
import { hasTrackingCode } from "@/lib/tracking";
import { motion } from "framer-motion";
import { ScanBarcode } from "lucide-react";

export default function ScannerPage() {
  const router = useRouter();
  const {
    state,
    sessionVersion,
    orders,
    scannedCount,
    totalCount,
    progress,
    currentResult,
    acknowledgeError,
    acknowledgeSuccess,
  } = useScanner();
  const refreshError = useTrackingRefresh();
  const missingTracking = orders.filter((order) => !hasTrackingCode(order.trackingCode));
  const [missingNotice, setMissingNotice] = useState(() => ({ sessionVersion, orders: missingTracking }));
  const [missingNoticeAcknowledged, setMissingNoticeAcknowledged] = useState(false);
  // Capture the initial list once per session, including after hydration.
  if (missingNotice.sessionVersion !== sessionVersion) {
    setMissingNotice({ sessionVersion, orders: missingTracking });
    setMissingNoticeAcknowledged(false);
  }
  const initialMissingTracking = missingNotice.orders;
  const showMissingNotice = !missingNoticeAcknowledged && initialMissingTracking.length > 0;

  // Redirect to dashboard if no orders loaded
  useEffect(() => {
    if (state === "idle" && orders.length === 0) {
      // Give a moment to check if orders are being loaded
      const timer = setTimeout(() => {
        if (orders.length === 0) {
          router.push("/");
        }
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [state, orders.length, router]);

  if (orders.length === 0) {
    return (
      <>
        <Header
          title="Scanner"
          subtitle="Carregando..."
          breadcrumbs={["Scanner Checkout", "Scanner"]}
        />
        <div className="flex items-center justify-center h-[50vh]">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-[var(--color-accent-blue)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[14px] text-[var(--color-text-secondary)]">
              Redirecionando para o Dashboard...
            </p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Header
        title="Bipagem"
        subtitle={`Escaneie o código de rastreamento de cada pedido`}
        breadcrumbs={["Scanner Checkout", "Scanner", "Bipagem"]}
      />

      {/* Hidden Input for Scanner */}
      <ScanInput disabled={showMissingNotice} />

      {missingTracking.length > 0 && (
        <div role="status" className="card p-4 mb-5 border border-[var(--color-accent-red)]/35 text-[13px] text-[var(--color-accent-red)]">
          {missingTracking.length} pedido(s) sem rastreio. Buscando códigos automaticamente na Olist.
          Você pode conferir os demais; o lote poderá ser finalizado quando todos forem bipados.
        </div>
      )}
      {missingTracking.length > 0 && refreshError && (
        <p role="status" className="mb-5 text-[13px] text-[var(--color-accent-orange)]">{refreshError}</p>
      )}

      {/* Progress Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card p-5 sm:p-6 mb-5"
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3.5">
            <div className="w-10 h-10 rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-accent-blue)] to-[var(--color-accent-green)] flex items-center justify-center">
              <ScanBarcode className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-[16px] font-semibold text-[var(--color-text-primary)]">
                {scannedCount} de {totalCount}
              </p>
              <p className="text-[12px] text-[var(--color-text-tertiary)]">
                pedidos conferidos
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[24px] font-bold text-[var(--color-accent-blue)]">
              {Math.round(progress)}%
            </p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="progress-bar">
          <div
            className="progress-bar-fill"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Scanner Status */}
          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[var(--color-border-light)]">
          <div className="relative">
            <div className="w-2 h-2 rounded-full bg-[var(--color-accent-green)]" />
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-[var(--color-accent-green)] animate-ping" />
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            {showMissingNotice || state === "error" ? "Scanner pausado — reconheça o aviso para continuar" : state === "complete" ? "Conferência concluída" : "Scanner ativo — aguardando bipagem"}
          </p>
        </div>
      </motion.div>

      {/* Order List */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-3 px-1">
          <h3 className="text-[14px] font-semibold text-[var(--color-text-secondary)]">
            Lista de Pedidos
          </h3>
          <span className="badge badge-pending">
            {totalCount - scannedCount} pendentes
          </span>
        </div>
        <OrderList orders={orders} />
      </motion.div>

      {/* Popups */}
      <ErrorPopup
        visible={showMissingNotice}
        title="Pedidos sem código de rastreio"
        message="Ao abrir esta página, os pedidos abaixo estavam sem rastreio. Reconheça o aviso para continuar. O app buscará os códigos automaticamente, preservando as bipagens já feitas."
        onDismiss={() => setMissingNoticeAcknowledged(true)}
      >
        <ul className="mb-6 max-h-48 overflow-y-auto space-y-2 text-left text-[13px]">
          {initialMissingTracking.map((order) => (
            <li key={order.id} className="rounded-lg bg-[var(--color-accent-red)]/8 p-3 text-[var(--color-accent-red)]">
              <strong>{order.clientName}</strong> — Yampi #{order.yampiId}
              {orders.some((current) => current.id === order.id && hasTrackingCode(current.trackingCode)) && (
                <span className="block text-[var(--color-accent-green)]">Rastreio recebido. Pronto para bipar.</span>
              )}
            </li>
          ))}
        </ul>
      </ErrorPopup>
      <SuccessPopup
        visible={!showMissingNotice && state === "success" && currentResult?.type === "success"}
        order={currentResult?.order}
        onDismiss={acknowledgeSuccess}
      />

      <ErrorPopup
        visible={!showMissingNotice && state === "error" && currentResult?.type === "error"}
        message={currentResult?.message || "Código inválido"}
        onDismiss={acknowledgeError}
      />

      {/* Completion */}
      {state === "complete" && <Completion />}
    </>
  );
}
