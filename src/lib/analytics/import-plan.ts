import { id, object, string } from "./normalize";
import { signedDecimalUnits } from "./engine";
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

/** Reconciliation requires the provider's total; a partial page is never a day total. */
export function reconciliationPage(listing: Record<string, unknown>, offset = 0) {
  const page = listingPage(listing, offset), raw = object(listing.paginacao).total;
  if (raw === undefined) throw new Error("Listagem Olist sem total para reconciliação.");
  return { ...page, total: Number(raw) };
}

export function reconciliationAmounts(entries: unknown[]) {
  const ids = new Set<string>();
  let count = 0, cents: bigint | null = BigInt(0);
  for (const entry of entries) {
    const row = object(entry), external = id(row.id);
    if (ids.has(external) || row.situacao == null || !Number.isInteger(Number(row.situacao)))
      throw new Error("Listagem Olist inconsistente para reconciliação.");
    ids.add(external);
    if (Number(row.situacao) === 2) continue;
    count++;
    if (cents !== null) {
      try {
        if (typeof row.valor !== "string" && typeof row.valor !== "number") throw new Error("Valor ausente.");
        cents += signedDecimalUnits(row.valor, 2);
      } catch { cents = null; }
    }
  }
  return { count, cents: cents?.toString() ?? null };
}
