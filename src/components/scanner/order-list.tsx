"use client";

import { memo, useMemo, useState } from "react";
import { orderReference } from "@/lib/order-reference";

import { Check, Clock, CalendarDays, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScanOrder } from "@/types";
import { motion } from "framer-motion";
import { hasTrackingCode } from "@/lib/tracking";
import { preventTrackingTransfer } from "@/lib/scanner-input-guard";

interface OrderListProps {
  orders: ScanOrder[];
}

function formatOrderDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("pt-BR");
}

const PAGE_SIZE = 100;

export const OrderList = memo(function OrderList({ orders }: OrderListProps) {
  const [page, setPage] = useState(0);
  // Show checked orders first (most recently scanned at top), then pending
  const sortedOrders = useMemo(() => [...orders].sort((a, b) => {
    if (a.status === "checked" && b.status === "pending") return -1;
    if (a.status === "pending" && b.status === "checked") return 1;
    // Within checked, most recent first
    if (a.status === "checked" && b.status === "checked") {
      return (b.scannedAt || "").localeCompare(a.scannedAt || "");
    }
    return 0;
  }), [orders]);
  const lastPage = Math.max(0, Math.ceil(orders.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const start = currentPage * PAGE_SIZE;
  const visibleOrders = sortedOrders.slice(start, start + PAGE_SIZE);

  return (
    <div className="space-y-2">
      {lastPage > 0 && <nav aria-label="Páginas de pedidos" className="flex items-center justify-between gap-3 mb-3 text-sm">
        <span>{start + 1}–{Math.min(start + PAGE_SIZE, orders.length)} de {orders.length} pedidos</span>
        <div className="flex gap-2">
          <button type="button" className="btn-secondary" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
          <button type="button" className="btn-secondary" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Próxima</button>
        </div>
      </nav>}
      {visibleOrders.map(order => <OrderRow key={order.id} order={order} />)}
    </div>
  );
});

const OrderRow = memo(function OrderRow({ order }: { order: ScanOrder }) {
  const isMissingTracking = !hasTrackingCode(order.trackingCode);
  const orderDate = formatOrderDate(order.dataCriacao);
  return (
    <motion.div
      key={order.id}
      initial={order.status === "checked" ? { scale: 0.95, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex items-center gap-3 p-3 rounded-[var(--radius-md)] transition-all duration-300",
        isMissingTracking
          ? "bg-[var(--color-accent-red)]/8 border border-[var(--color-accent-red)]/35"
          : order.status === "checked"
          ? "bg-[var(--color-accent-green)]/6 border border-[var(--color-accent-green)]/15"
          : "bg-white border border-[var(--color-border-light)]"
      )}
    >
      {/* Status Icon */}
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300",
          isMissingTracking
            ? "bg-[var(--color-accent-red)]"
            : order.status === "checked"
            ? "bg-[var(--color-accent-green)] shadow-sm"
            : "bg-[var(--color-bg-primary)]"
        )}
      >
        {isMissingTracking ? (
          <AlertTriangle className="w-4 h-4 text-white" />
        ) : order.status === "checked" ? (
          <Check className="w-4 h-4 text-white" />
        ) : (
          <Clock className="w-4 h-4 text-[var(--color-text-tertiary)]" />
        )}
      </div>

      {/* Order Info */}
      <div className="flex-1 min-w-0">
        <p
          className={cn(
            "text-[14px] font-medium truncate",
            isMissingTracking
              ? "text-[var(--color-accent-red)]"
              : order.status === "checked"
              ? "text-[var(--color-accent-green)]"
              : "text-[var(--color-text-primary)]"
          )}
        >
          {order.clientName}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {isMissingTracking ? (
            <p className="text-[11px] font-semibold text-[var(--color-accent-red)]">
              Pedido sem código de rastreio
            </p>
          ) : (
            <p className="text-[11px] text-[var(--color-text-tertiary)] font-mono select-none" draggable={false}
              onCopy={preventTrackingTransfer} onCut={preventTrackingTransfer} onDragStart={preventTrackingTransfer}>
              {order.trackingCode}
            </p>
          )}
          <span className="text-[10px] text-[var(--color-text-tertiary)]">•</span>
          <p className="text-[11px] text-[var(--color-text-tertiary)]">
            {orderReference(order)}
          </p>
          {orderDate && (
            <>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">•</span>
              <p className="flex items-center gap-1 text-[11px] text-[var(--color-text-tertiary)]">
                <CalendarDays className="w-3 h-3" />
                {orderDate}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Badge */}
      <span
        className={cn(
          "badge flex-shrink-0",
          isMissingTracking
            ? "bg-[var(--color-accent-red)]/10 text-[var(--color-accent-red)] border border-[var(--color-accent-red)]/25"
            : order.status === "checked" ? "badge-checked" : "badge-pending"
        )}
      >
        {isMissingTracking ? "Sem rastreio" : order.status === "checked" ? "✓ Bipado" : "Pendente"}
      </span>
    </motion.div>
  );
});
