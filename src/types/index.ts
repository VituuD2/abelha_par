/* ===== Olist API Types ===== */

export interface OlistWebhookStatus {
  status: "active" | "pending" | "unknown";
  lastReceivedAt: string | null;
}

export interface OlistOrder {
  id: number;
  /** List responses with omitted required fields must be resolved before scanning. */
  needsDetail?: boolean;
  yampiId: string | null;
  trackingCode: string;
  clientName: string;
  numeroPedido: number;
  dataCriacao: string | null;
  situacao: number | null;
  ecommerceId?: number | null;
  ecommerceName?: string;
  ecommerceOrderNumber?: string | null;
  ecommerceChannelOrderNumber?: string | null;
}

export interface ScanOrder extends OlistOrder {
  nuvemshopId?: number;
  nuvemshopNumber?: string;
  nuvemshopStoreId?: string;
  status: 'pending' | 'checked';
  scannedAt?: string;
}

export interface NuvemshopOrder {
  id: number;
  storeId: string;
  number: string;
  clientName: string;
  status: string;
  paymentStatus: string;
  shippingStatus: string;
  createdAt: string;
  updatedAt: string;
  total: string;
  currency: string;
}

export interface ReconciliationConfig {
  ecommerceId: number;
  referenceField: "ecommerceOrderNumber" | "ecommerceChannelOrderNumber";
  referenceKind: "id" | "number";
}

export interface StoredScanSession {
  id: string;
  orders: ScanOrder[];
  responsible: string;
  revision: number;
  status: "active" | "completed";
  batch_id: string | null;
}

export interface Batch {
  id: string;
  numero_lote: number;
  responsavel: string;
  data: string;
  qtd_pedidos: number;
  pedidos: ScanOrder[];
  created_at: string;
}

/* ===== API Response Types (Tiny ERP API v3) ===== */

export interface OlistApiOrder {
  id: number;
  numeroPedido: number;
  situacao?: number;
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
