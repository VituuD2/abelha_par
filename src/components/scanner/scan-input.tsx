"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Barcode, ScanLine } from "lucide-react";
import { useScanStore } from "@/stores/scan-store";
import { isPasteShortcut, isTransferredInput } from "@/lib/scanner-input-guard";
import { prepareAudio, playVictory } from "@/lib/sounds";

interface ScanInputProps {
  disabled?: boolean;
}

export function ScanInput({ disabled = false }: ScanInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [transferNotice, setTransferNotice] = useState<string | null>(null);
  const processBarcode = useScanStore((state) => state.submitBarcode);
  const busy = useScanStore((state) => state.busy);
  const scannerState = useScanStore((state) => state.state);
  const isDisabled = disabled || busy || scannerState === "error" || scannerState === "complete";

  const focusInput = useCallback(() => {
    if (!isDisabled) inputRef.current?.focus();
  }, [isDisabled]);

  useEffect(() => {
    focusInput();
    window.addEventListener("focus", focusInput);
    return () => window.removeEventListener("focus", focusInput);
  }, [focusInput]);

  const blockTransfer = useCallback((event: { preventDefault(): void }) => {
    event.preventDefault();
    setValue("");
    setTransferNotice("Colagem e arrastar códigos não são permitidos. Leia o código na etiqueta com o scanner.");
    inputRef.current?.focus();
  }, []);

  const submit = useCallback(async () => {
    const code = value.trim();
    if (!code || isDisabled) return;
    // Unlock audio during the gesture, before waiting for the server response.
    prepareAudio();
    const sessionId = useScanStore.getState().sessionId;
    setValue("");
    setTransferNotice(null);
    await processBarcode(code);
    const current = useScanStore.getState();
    if (current.sessionId === sessionId && current.state === "complete" && current.currentResult?.type === "success") playVictory();
  }, [isDisabled, processBarcode, value]);

  const handleSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit();
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
          onChange={(event) => { setValue(event.target.value); setTransferNotice(null); }}
          onPaste={blockTransfer}
          onDrop={blockTransfer}
          onDragOver={event => event.preventDefault()}
          onBeforeInput={event => { if (isTransferredInput((event.nativeEvent as InputEvent).inputType)) blockTransfer(event); }}
          onKeyDown={event => { if (isPasteShortcut(event)) blockTransfer(event); }}
          disabled={isDisabled}
          type="text"
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={200}
          aria-describedby={transferNotice ? "scanner-transfer-notice" : undefined}
          placeholder="Aponte o scanner ou digite o código"
          className="flex-1 min-w-0 px-4 py-3 rounded-[var(--radius-md)] border border-[var(--color-border-medium)] bg-[var(--color-bg-elevated)] text-[15px] font-mono text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-blue)]/30 focus:border-[var(--color-accent-blue)] disabled:opacity-50"
          aria-label="Código de rastreamento"
        />
        <button type="submit" disabled={isDisabled || !value.trim()} className="btn-primary px-5 sm:px-4">
          <ScanLine className="w-5 h-5" />
          {busy ? "Registrando…" : "Bipar"}
        </button>
      </form>
      {transferNotice && <p id="scanner-transfer-notice" role="status" className="mt-3 text-sm text-[var(--color-accent-orange)]">{transferNotice}</p>}
    </section>
  );
}
