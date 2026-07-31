"use client";

import { Package, Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScanOrder } from "@/types";
import { motion } from "framer-motion";

interface OrderListProps {
  orders: ScanOrder[];
}

export function OrderList({ orders }: OrderListProps) {
  // Show checked orders first (most recently scanned at top), then pending
  const sortedOrders = [...orders].sort((a, b) => {
    if (a.status === "checked" && b.status === "pending") return -1;
    if (a.status === "pending" && b.status === "checked") return 1;
    // Within checked, most recent first
    if (a.status === "checked" && b.status === "checked") {
      return (b.scannedAt || "").localeCompare(a.scannedAt || "");
    }
    return 0;
  });

  return (
    <div className="space-y-2">
      {sortedOrders.map((order, index) => (
        <motion.div
          key={order.id}
          initial={order.status === "checked" ? { scale: 0.95, opacity: 0 } : false}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.2 }}
          className={cn(
            "flex items-center gap-3 p-3 rounded-[var(--radius-md)] transition-all duration-300",
            order.status === "checked"
              ? "bg-[var(--color-accent-green)]/6 border border-[var(--color-accent-green)]/15"
              : "bg-white border border-[var(--color-border-light)]"
          )}
        >
          {/* Status Icon */}
          <div
            className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300",
              order.status === "checked"
                ? "bg-[var(--color-accent-green)] shadow-sm"
                : "bg-[var(--color-bg-primary)]"
            )}
          >
            {order.status === "checked" ? (
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
                order.status === "checked"
                  ? "text-[var(--color-accent-green)]"
                  : "text-[var(--color-text-primary)]"
              )}
            >
              {order.clientName}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-[11px] text-[var(--color-text-tertiary)] font-mono">
                {order.trackingCode}
              </p>
              <span className="text-[10px] text-[var(--color-text-tertiary)]">•</span>
              <p className="text-[11px] text-[var(--color-text-tertiary)]">
                Yampi #{order.yampiId}
              </p>
            </div>
          </div>

          {/* Badge */}
          <span
            className={cn(
              "badge flex-shrink-0",
              order.status === "checked" ? "badge-checked" : "badge-pending"
            )}
          >
            {order.status === "checked" ? "✓ Bipado" : "Pendente"}
          </span>
        </motion.div>
      ))}
    </div>
  );
}
