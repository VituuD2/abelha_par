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

  // A barcode scanner behaves like a keyboard. While the error is visible,
  // discard every key event so a following scan cannot dismiss the modal.
  useEffect(() => {
    if (!visible) return;

    const blockKeyboardInput = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", blockKeyboardInput, true);
    window.addEventListener("keypress", blockKeyboardInput, true);
    window.addEventListener("keyup", blockKeyboardInput, true);
    return () => {
      window.removeEventListener("keydown", blockKeyboardInput, true);
      window.removeEventListener("keypress", blockKeyboardInput, true);
      window.removeEventListener("keyup", blockKeyboardInput, true);
    };
  }, [visible]);

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
              <button
                type="button"
                onClick={(event) => {
                  // Keyboard-triggered clicks have detail 0; only a pointer
                  // click can acknowledge the error.
                  if (event.detail > 0) onDismiss();
                }}
                onKeyDown={(event) => event.preventDefault()}
                className="btn-danger w-full py-3"
              >
                <AlertTriangle className="w-4 h-4" />
                Reconhecer Erro e Continuar
              </button>

              <p className="text-[11px] text-[var(--color-text-tertiary)] mt-3">
                Clique no botão para reconhecer o erro e continuar.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
