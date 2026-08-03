"use client";

import { useCallback, useRef, useState } from "react";
import { AlertCircle, Check, FileSpreadsheet, Upload } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

interface UploadCardProps {
  onUpload: (yampiIds: Set<string>, fileName: string, totalRows: number) => void;
  onClear: () => void;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function UploadCard({ onUpload, onClear }: UploadCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(async (file: File) => {
    setIsProcessing(true);
    setError(null);
    try {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name) || file.size > MAX_FILE_SIZE) {
        throw new Error("Envie uma planilha .xlsx, .xls ou .csv de até 10 MB.");
      }
      const buffer = await file.arrayBuffer();
      const { getSpreadsheetInfo } = await import("@/lib/yampi");
      const info = getSpreadsheetInfo(buffer);
      if (info.yampiIds.size === 0) throw new Error("Nenhum ID de pedido foi encontrado.");

      setUploadedFile(file.name);
      setTotalRows(info.totalRows);
      onUpload(info.yampiIds, file.name, info.totalRows);
    } catch (reason) {
      setError(`Erro ao processar planilha: ${reason instanceof Error ? reason.message : "formato inválido"}`);
    } finally {
      setIsProcessing(false);
    }
  }, [onUpload]);

  const clear = useCallback(() => {
    setUploadedFile(null);
    setTotalRows(0);
    onClear();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [onClear]);

  return (
    <div className="card p-6 lg:p-8 flex flex-col h-full min-h-[380px]">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-14 h-14 p-3 rounded-[var(--radius-lg)] bg-[var(--color-accent-purple)]/10 flex items-center justify-center shrink-0">
          <FileSpreadsheet className="w-7 h-7 text-[var(--color-accent-purple)]" />
        </div>
        <div><h3 className="text-[18px] font-semibold text-[var(--color-text-primary)]">Planilha Yampi</h3><p className="text-[14px] text-[var(--color-text-tertiary)] mt-1">Upload da planilha de pedidos</p></div>
      </div>

      <AnimatePresence mode="wait">
        {uploadedFile ? (
          <motion.div key="uploaded" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-4 p-5 rounded-[var(--radius-lg)] bg-[var(--color-accent-green)]/8 border border-[var(--color-accent-green)]/20">
            <div className="w-10 h-10 rounded-full bg-[var(--color-accent-green)] flex items-center justify-center"><Check className="w-5 h-5 text-white" /></div>
            <div className="min-w-0 flex-1"><p className="text-[15px] font-medium truncate">{uploadedFile}</p><p className="text-[13px] text-[var(--color-text-secondary)]">{totalRows} pedidos encontrados</p></div>
            <button onClick={clear} className="btn-ghost text-[13px]">Trocar</button>
          </motion.div>
        ) : (
          <motion.div key="dropzone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`drop-zone flex-1 flex flex-col justify-center ${isDragging ? "drop-zone-active" : ""}`} onDrop={(event) => { event.preventDefault(); setIsDragging(false); const file = event.dataTransfer.files[0]; if (file) void processFile(file); }} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onClick={() => fileInputRef.current?.click()}>
            {isProcessing ? <p className="text-center text-[15px]">Processando planilha...</p> : <div className="flex flex-col items-center gap-3"><Upload className="w-10 h-10 text-[var(--color-text-tertiary)]" /><p className="text-[15px] text-[var(--color-text-secondary)]">Arraste um arquivo .xlsx, .xls ou .csv aqui</p><p className="text-[13px] text-[var(--color-text-tertiary)]">ou clique para selecionar</p></div>}
          </motion.div>
        )}
      </AnimatePresence>
      <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void processFile(file); }} className="hidden" />
      {error && <div role="alert" className="flex items-center gap-2 mt-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-red)]/8"><AlertCircle className="w-4 h-4 text-[var(--color-accent-red)]" /><p className="text-[13px] text-[var(--color-accent-red)]">{error}</p></div>}
    </div>
  );
}
