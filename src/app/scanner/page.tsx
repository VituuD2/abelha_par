"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Header } from "@/components/layout/header";
import { ScanInput } from "@/components/scanner/scan-input";
import { OrderList } from "@/components/scanner/order-list";
import { SuccessPopup } from "@/components/scanner/success-popup";
import { ErrorPopup } from "@/components/scanner/error-popup";
import { Completion } from "@/components/scanner/completion";
import { useScanner } from "@/hooks/use-scanner";
import { motion } from "framer-motion";
import { ScanBarcode, Wifi } from "lucide-react";

export default function ScannerPage() {
  const router = useRouter();
  const {
    state,
    orders,
    scannedCount,
    totalCount,
    progress,
    currentResult,
    acknowledgeError,
    acknowledgeSuccess,
  } = useScanner();

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
      <ScanInput />

      {/* Progress Section */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card p-5 mb-5"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
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
        <div className="flex items-center gap-2 mt-3">
          <div className="relative">
            <div className="w-2 h-2 rounded-full bg-[var(--color-accent-green)]" />
            <div className="absolute inset-0 w-2 h-2 rounded-full bg-[var(--color-accent-green)] animate-ping" />
          </div>
          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Scanner ativo — aguardando bipagem
          </p>
        </div>
      </motion.div>

      {/* Order List */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-3">
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
      <SuccessPopup
        visible={state === "success" && currentResult?.type === "success"}
        order={currentResult?.order}
        onDismiss={acknowledgeSuccess}
      />

      <ErrorPopup
        visible={state === "error" && currentResult?.type === "error"}
        message={currentResult?.message || "Código inválido"}
        onDismiss={acknowledgeError}
      />

      {/* Completion */}
      {state === "complete" && <Completion />}
    </>
  );
}
