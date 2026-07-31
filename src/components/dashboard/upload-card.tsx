"use client";

import { useCallback, useState, useRef } from "react";
import { Upload, FileSpreadsheet, Check, AlertCircle } from "lucide-react";
import { parseYampiSpreadsheet, getSpreadsheetInfo } from "@/lib/yampi";
import { motion, AnimatePresence } from "framer-motion";

interface UploadCardProps {
  onUpload: (yampiIds: Set<string>, fileName: string, totalRows: number) => void;
}

export function UploadCard({ onUpload }: UploadCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<string | null>(null);
  const [totalRows, setTotalRows] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      setIsProcessing(true);
      setError(null);

      try {
        const buffer = await file.arrayBuffer();
        const info = getSpreadsheetInfo(buffer);
        const yampiIds = parseYampiSpreadsheet(buffer);

        if (yampiIds.size === 0) {
          setError("Nenhum ID encontrado na planilha. Verifique se a primeira coluna contém os IDs.");
          setIsProcessing(false);
          return;
        }

        setUploadedFile(file.name);
        setTotalRows(info.totalRows);
        onUpload(yampiIds, file.name, info.totalRows);
      } catch (err) {
        setError(
          `Erro ao processar planilha: ${err instanceof Error ? err.message : "Formato inválido"}`
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [onUpload]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile]
  );

  return (
    <div className="card p-6 flex flex-col h-full min-h-[320px]">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-[var(--radius-md)] bg-[var(--color-accent-purple)]/10 flex items-center justify-center">
          <FileSpreadsheet className="w-5 h-5 text-[var(--color-accent-purple)]" />
        </div>
        <div>
          <h3 className="text-[16px] font-semibold text-[var(--color-text-primary)]">
            Planilha Yampi
          </h3>
          <p className="text-[13px] text-[var(--color-text-tertiary)]">
            Upload da planilha de pedidos
          </p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {uploadedFile ? (
          <motion.div
            key="uploaded"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex items-center gap-3 p-4 rounded-[var(--radius-md)] bg-[var(--color-accent-green)]/8 border border-[var(--color-accent-green)]/20"
          >
            <div className="w-8 h-8 rounded-full bg-[var(--color-accent-green)] flex items-center justify-center flex-shrink-0">
              <Check className="w-4 h-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-[var(--color-text-primary)] truncate">
                {uploadedFile}
              </p>
              <p className="text-[12px] text-[var(--color-text-secondary)]">
                {totalRows} pedidos encontrados
              </p>
            </div>
            <button
              onClick={() => {
                setUploadedFile(null);
                setTotalRows(0);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              className="btn-ghost text-[13px] ml-auto flex-shrink-0"
            >
              Trocar
            </button>
          </motion.div>
        ) : (
          <motion.div
            key="dropzone"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className={`drop-zone flex-1 flex flex-col justify-center ${isDragging ? "drop-zone-active" : ""}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current?.click()}
            >
              {isProcessing ? (
                <div className="flex flex-col items-center gap-2">
                  <div className="w-8 h-8 border-2 border-[var(--color-accent-blue)] border-t-transparent rounded-full animate-spin" />
                  <p className="text-[14px] text-[var(--color-text-secondary)]">
                    Processando planilha...
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-[var(--color-text-tertiary)]" />
                  <p className="text-[14px] text-[var(--color-text-secondary)]">
                    Arraste um arquivo <span className="font-semibold">.xlsx</span> ou{" "}
                    <span className="font-semibold">.csv</span> aqui
                  </p>
                  <p className="text-[12px] text-[var(--color-text-tertiary)]">
                    ou clique para selecionar
                  </p>
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.csv,.xls"
              onChange={handleFileSelect}
              className="hidden"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 mt-3 p-3 rounded-[var(--radius-md)] bg-[var(--color-accent-red)]/8"
          >
            <AlertCircle className="w-4 h-4 text-[var(--color-accent-red)] flex-shrink-0" />
            <p className="text-[13px] text-[var(--color-accent-red)]">{error}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
