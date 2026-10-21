import { object, string } from "./normalize";
import type { SyncJob } from "./types";

export const dayAfter = (day: string, days = 1) =>
  new Date(Date.parse(day + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
export type UpdateScan = {
  version: 2; since: string; floor: string; ceiling: string;
  from: string; to: string; days: number;
};
export type OrderStage = {
  externalId: string; fetchedAt: string; connectionVersion: number;
  raw: Record<string, unknown>; invoice?: Record<string, unknown> | null;
  invoiceChecked?: boolean; tags?: unknown[]; tagsChecked?: boolean;
};
export type ImportState = { scan?: UpdateScan; order?: OrderStage | null };

/** A valid empty array is authoritative; an absent/malformed field needs fallback. */
export function orderMarkers(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value) || value.some(v => !v || typeof v !== "object" || Array.isArray(v)
    || typeof (v as Record<string, unknown>).descricao !== "string")) return undefined;
  return value.map(v => ({ descricao: string(object(v).descricao) }));
}

/** Persist only fields consumed by normalization, not addresses, documents or tokens. */
export function stageOrder(raw: Record<string, unknown>): Record<string, unknown> {
  const pick = (v: unknown, keys: string[]) => Object.fromEntries(keys
    .filter(k => object(v)[k] !== undefined).map(k => [k, object(v)[k]]));
  return {
    ...pick(raw, ["id", "situacao", "data", "dataCriacao", "dataFaturamento", "numeroPedido", "origemPedido",
      "idNotaFiscal", "valorTotalPedido", "valorTotalProdutos", "valorDesconto"]),
    cliente: { ...pick(raw.cliente, ["id", "nome"]), endereco: pick(object(raw.cliente).endereco, ["uf"]) },
    enderecoEntrega: pick(raw.enderecoEntrega, ["uf"]),
    vendedor: pick(raw.vendedor, ["nome"]), naturezaOperacao: pick(raw.naturezaOperacao, ["nome"]),
    ecommerce: pick(raw.ecommerce, ["id", "nome", "canalVenda", "numeroPedidoCanalVenda", "numeroPedidoEcommerce"]),
    ...(Array.isArray(raw.itens) ? { itens: raw.itens.map(v => ({
      ...pick(v, ["quantidade", "valorUnitario"]), produto: pick(object(v).produto, ["id", "sku", "descricao"]),
    })) } : {}),
    ...(orderMarkers(raw.marcadores) !== undefined ? { marcadores: orderMarkers(raw.marcadores) } : {}),
  };
}

export function reusableStage(stage: OrderStage | null | undefined, externalId: string, version: number, now = Date.now()) {
  const age = now - Date.parse(stage?.fetchedAt || "");
  return !!stage && stage.externalId === externalId && stage.connectionVersion === version
    && age >= 0 && age < 10 * 60000 && string(stage.raw?.id) === externalId;
}

export function initialScan(job: SyncJob, floor: string, ceiling: string): UpdateScan {
  return { version: 2, since: job.from_date, floor, ceiling, from: floor,
    to: [dayAfter(floor, 6), ceiling].sort()[0], days: 7 };
}

/** Listing shape errors must not advance a page or falsely complete coverage. */
export function listingPage(listing: Record<string, unknown>, offset: number) {
  if (!Array.isArray(listing.itens) || listing.itens.length > 100) throw new Error("Listagem de pedidos Olist inválida.");
  const entries = listing.itens;
  const rawTotal = object(listing.paginacao).total;
  if (rawTotal !== undefined && (rawTotal === null || typeof rawTotal === "boolean" || string(rawTotal) === ""))
    throw new Error("Paginação de pedidos Olist inválida.");
  const total = rawTotal === undefined ? undefined : Number(rawTotal);
  if (total !== undefined && (!Number.isSafeInteger(total) || total < offset + entries.length))
    throw new Error("Paginação de pedidos Olist inválida.");
  const done = total === undefined ? entries.length < 100 : offset + entries.length >= total;
  if (!entries.length && !done) throw new Error("Página de pedidos vazia antes do fim da consulta.");
  return { entries, done };
}
