"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Barcode, ScanLine } from "lucide-react";
import { useScanStore } from "@/stores/scan-store";

interface ScanInputProps {
  disabled?: boolean;
}

export function ScanInput({ disabled = false }: ScanInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const processBarcode = useScanStore((state) => state.processBarcode);
  const scannerState = useScanStore((state) => state.state);
  const isDisabled = disabled || scannerState === "error" || scannerState === "complete";

  const focusInput = useCallback(() => {
    if (!isDisabled) inputRef.current?.focus();
  }, [isDisabled]);

  useEffect(() => {
    focusInput();
    window.addEventListener("focus", focusInput);
    return () => window.removeEventListener("focus", focusInput);
  }, [focusInput]);

  const submit = useCallback(() => {
    const code = value.trim();
    if (!code || isDisabled) return;
    processBarcode(code);
    setValue("");
  }, [isDisabled, processBarcode, value]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  }, [submit]);

  return (
    <section className="card p-5 sm:p-6 mb-5" aria-label="Leitor de código de rastreamento">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-accent-blue)]/10 flex items-center justify-center">
          <Barcode className="w-5 h-5 text-[var(--color-accent-blue)]" />
        </div>
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Código de rastreamento</h2>
          <p className="text-[12px] text-[var(--color-text-tertiary)]">Correios: código completo. Loggi: etiqueta de 20 caracteres, usando os 8 últimos caracteres.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={isDisabled}
          type="text"
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Aponte o scanner ou digite o código"
          className="flex-1 min-w-0 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] text-[15px] font-mono text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/30 focus:border-[var(--color-accent-blue)] disabled:opacity-50"
          aria-label="Código de rastreamento"
        />
        <button type="submit" disabled={isDisabled || !value.trim()} className="btn-primary px-5 sm:px-4">
          <ScanLine className="w-5 h-5" />
          Bipar
        </button>
      </form>
    </section>
  );
}
