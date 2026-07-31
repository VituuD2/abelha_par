/* ===== Olist API Types ===== */

export interface OlistOrder {
  id: number;
  yampiId: string | null;
  trackingCode: string;
  clientName: string;
  numeroPedido: number;
}

export interface ScanOrder extends OlistOrder {
  yampiId: string; // guaranteed non-null after matching
  status: 'pending' | 'checked';
  scannedAt?: string;
}

export interface Batch {
  id: string;
  numero_lote: number;
  data: string;
  qtd_pedidos: number;
  pedidos: ScanOrder[];
  created_at: string;
}

/* ===== API Response Types ===== */

export interface OlistApiOrder {
  id: number;
  numero: number;
  numero_ecommerce: string;
  data_pedido: string;
  data_prevista: string;
  nome: string;
  situacao: {
    id: number;
    valor: string;
  };
  codigo_rastreamento: string;
  observacoes: string;
  observacao_interna: string;
}

export interface OlistApiResponse {
  itens: OlistApiOrder[];
  paginacao: {
    paginas: number;
    itens_pagina: number;
    total_itens: number;
    pagina_atual: number;
  };
}

export interface OlistDetailResponse {
  id: number;
  numero: number;
  nome: string;
  codigo_rastreamento: string;
  observacoes: string;
  observacao_interna: string;
}

/* ===== Scanner State Types ===== */

export type ScannerState = 'idle' | 'scanning' | 'success' | 'error' | 'complete';

export interface ScanResult {
  type: 'success' | 'error';
  message: string;
  order?: ScanOrder;
}

/* ===== Store Types ===== */

export interface ScanSession {
  orders: ScanOrder[];
  scannedCount: number;
  totalCount: number;
  currentResult: ScanResult | null;
  state: ScannerState;
}
