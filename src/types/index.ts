/* ===== Olist API Types ===== */

export interface OlistOrder {
  id: number;
  yampiId: string | null;
  trackingCode: string;
  clientName: string;
  numeroPedido: number;
  dataCriacao: string | null;
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

/* ===== API Response Types (Tiny ERP API v3) ===== */

export interface OlistApiOrder {
  id: number;
  numeroPedido: number;
  situacao: number;
  dataCriacao?: string;
  data?: string;
  dataPrevista: string;
  valor: string;
  origemPedido: number;
  ecommerce?: {
    id: number;
    nome: string;
    numeroPedidoEcommerce?: string;
    numeroPedidoCanalVenda?: string;
    canalVenda?: string;
  };
  cliente?: {
    id: number;
    nome: string;
    codigo?: string;
    cpfCnpj?: string;
    email?: string;
  };
  transportador?: {
    id: number;
    nome: string;
    codigoRastreamento?: string;
    urlRastreamento?: string;
    formaEnvio?: { id: number; nome: string };
  };
  vendedor?: {
    id: number;
    nome: string;
  };
  // Fields from detail endpoint
  observacoes?: string;
  observacaoInterna?: string;
  observacao_interna?: string;
  observacoesInternas?: string;
  observacoes_internas?: string;
}

export interface OlistApiResponse {
  itens: OlistApiOrder[];
  paginacao: {
    limit: number;
    offset: number;
    total: number;
  };
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
