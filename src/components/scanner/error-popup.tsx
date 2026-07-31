"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, XCircle } from "lucide-react";
import { playError } from "@/lib/sounds";

interface ErrorPopupProps {
  visible: boolean;
  message: string;
  onDismiss: () => void;
}

export function ErrorPopup({ visible, message, onDismiss }: ErrorPopupProps) {
  useEffect(() => {
    if (visible) {
      playError();
    }
  }, [visible]);

  // Handle keyboard dismiss
  useEffect(() => {
    if (!visible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        onDismiss();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible, onDismiss]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[200] flex items-center justify-center p-4"
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 glass-error"
            style={{
              background: "rgba(255, 59, 48, 0.12)",
              backdropFilter: "blur(40px)",
              WebkitBackdropFilter: "blur(40px)",
            }}
          />

          {/* Modal */}
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative w-full max-w-sm"
          >
            <div className="bg-white rounded-[var(--radius-2xl)] p-8 shadow-2xl text-center">
              {/* Error Icon */}
              <motion.div
                initial={{ scale: 0, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: "spring", stiffness: 500, delay: 0.1 }}
                className="w-16 h-16 rounded-full bg-[var(--color-accent-red)]/10 flex items-center justify-center mx-auto mb-4"
              >
                <XCircle className="w-8 h-8 text-[var(--color-accent-red)]" />
              </motion.div>

              {/* Title */}
              <h2 className="text-[20px] font-bold text-[var(--color-text-primary)] mb-2">
                Código Inválido
              </h2>

              {/* Message */}
              <p className="text-[14px] text-[var(--color-text-secondary)] mb-6 leading-relaxed">
                {message}
              </p>

              {/* Dismiss Button */}
              <button onClick={onDismiss} className="btn-danger w-full py-3">
                <AlertTriangle className="w-4 h-4" />
                Reconhecer Erro e Continuar
              </button>

              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-3">
                Pressione <kbd className="px-1.5 py-0.5 rounded bg-gray-100 text-[10px] font-mono">ESC</kbd> ou{" "}
                <kbd className="px-1.5 py-0.5 rounded bg-gray-100 text-[10px] font-mono">Enter</kbd> para fechar
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
