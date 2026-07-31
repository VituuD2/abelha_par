"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Package } from "lucide-react";
import { playSuccess } from "@/lib/sounds";
import type { ScanOrder } from "@/types";

interface SuccessPopupProps {
  visible: boolean;
  order?: ScanOrder;
  onDismiss: () => void;
}

export function SuccessPopup({ visible, order, onDismiss }: SuccessPopupProps) {
  useEffect(() => {
    if (visible) {
      playSuccess();
      const timer = setTimeout(onDismiss, 2000);
      return () => clearTimeout(timer);
    }
  }, [visible, onDismiss]);

  return (
    <AnimatePresence>
      {visible && order && (
        <motion.div
          initial={{ opacity: 0, y: -30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] w-[90%] max-w-md"
        >
          <div className="glass rounded-[var(--radius-xl)] p-4 shadow-xl border border-[var(--color-accent-green)]/20 bg-gradient-to-r from-[var(--color-accent-green)]/10 to-transparent">
            <div className="flex items-center gap-3">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: "spring", stiffness: 500, delay: 0.1 }}
                className="w-10 h-10 rounded-full bg-[var(--color-accent-green)] flex items-center justify-center flex-shrink-0 shadow-lg"
              >
                <CheckCircle2 className="w-5 h-5 text-white" />
              </motion.div>
              <div className="min-w-0">
                <p className="text-[15px] font-semibold text-[var(--color-text-primary)]">
                  Pedido Conferido ✓
                </p>
                <p className="text-[13px] text-[var(--color-text-secondary)] truncate">
                  {order.clientName}
                </p>
                <p className="text-[11px] text-[var(--color-text-tertiary)] font-mono mt-0.5">
                  {order.trackingCode}
                </p>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
