"use client";

import { useRef, useEffect, useCallback } from "react";
import { useScanStore } from "@/stores/scan-store";

interface ScanInputProps {
  disabled?: boolean;
}

export function ScanInput({ disabled = false }: ScanInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const processBarcode = useScanStore((state) => state.processBarcode);
  const state = useScanStore((state) => state.state);

  // Focus only on mount/state changes and window return; avoid permanent polling.
  useEffect(() => {
    const focusInput = () => {
      if (
        inputRef.current &&
        state !== "error" &&
        state !== "complete" &&
        !disabled
      ) {
        inputRef.current.focus();
      }
    };

    focusInput();
    window.addEventListener("focus", focusInput);
    return () => window.removeEventListener("focus", focusInput);
  }, [state, disabled]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const value = (e.target as HTMLInputElement).value.trim();
        if (value) {
          processBarcode(value);
          (e.target as HTMLInputElement).value = "";
        }
      }
    },
    [processBarcode]
  );

  return (
    <input
      ref={inputRef}
      type="text"
      onKeyDown={handleKeyDown}
      disabled={disabled || state === "error" || state === "complete"}
      className="fixed opacity-0 w-0 h-0 pointer-events-auto"
      aria-label="Scanner barcode input"
      autoComplete="off"
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck={false}
    />
  );
}
