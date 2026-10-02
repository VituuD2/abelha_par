import { decimalUnits, lineCents } from "./engine";
type Raw = Record<string, unknown>;
export const object = (v: unknown): Raw =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {};
export const string = (v: unknown) =>
  typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
export function id(v: unknown): string {
  const raw = string(v);
  if (!/^\d+$/.test(raw) || BigInt(raw) <= BigInt(0))
    throw new Error("Identificador Olist inválido.");
  return raw;
}
export const nullable = (v: unknown) => string(v) || null;
export function saleDate(v: unknown): string {
  const raw = string(v);
  if (/T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime()))
      throw new Error("Data comercial inválida.");
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
    }).format(parsed);
  }
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw);
  const date = br ? `${br[3]}-${br[2]}-${br[1]}` : raw.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(date + "T12:00:00Z").toISOString().slice(0, 10) !== date
  )
    throw new Error("Pedido sem data comercial válida.");
  return date;
}
export function normalizeOrder(
  raw: Raw,
  connectionId: string,
  sourceId: string,
  fetchedAt: string,
  products: Record<string, Raw> = {},
  invoice?: Raw,
  tags?: unknown[],
) {
  const externalId = id(raw.id),
    customer = object(raw.cliente),
    ecommerce = object(raw.ecommerce);
  if (!Array.isArray(raw.itens) || !raw.itens.length)
    throw new Error("Pedido sem itens; importação aguardando detalhe válido.");
  const quality: string[] = [];
  const items = raw.itens.map((value, index) => {
    const item = object(value),
      product = object(item.produto),
      productId = id(product.id),
      detail = products[productId] || {},
      parent = object(detail.produtoPai);
    const quantity = string(item.quantidade),
      price = string(item.valorUnitario);
    if (decimalUnits(quantity) <= BigInt(0))
      throw new Error("Quantidade inválida no item do pedido.");
    let parentId: string | null = null;
    try {
      parentId = id(parent.id);
    } catch {
      /* Missing relation remains individual. */
    }
    if (!detail.id) quality.push("produto_sem_enriquecimento");
    return {
      position: index,
      product_id: productId,
      name:
        string(detail.descricao || product.descricao) || `Produto ${productId}`,
      sku: nullable(detail.sku || product.sku),
      parent_id: parentId,
      parent_name: parentId ? nullable(parent.descricao) : null,
      gtin: nullable(detail.gtin),
      category: nullable(
        object(detail.categoria).caminhoCompleto ||
          object(detail.categoria).nome,
      ),
      brand: nullable(object(detail.marca).nome),
      enriched_at: detail.id ? string(detail.__enriched_at) || fetchedAt : null,
      enrichment_error: detail.id ? null : "Cadastro ainda não enriquecido.",
      quantity,
      unit_price: price,
      gross_cents: lineCents(price, quantity),
    };
  });
  if (raw.valorTotalProdutos !== undefined && raw.valorTotalProdutos !== null) {
    const sum = items.reduce(
        (total, item) => total + BigInt(item.gross_cents),
        BigInt(0),
      ),
      declared = decimalUnits(string(raw.valorTotalProdutos), 2);
    if (sum !== declared) quality.push("total_itens_diverge_do_total_produtos");
  }
  let customerId: string | null = null;
  try {
    customerId = id(customer.id);
  } catch {
    quality.push("cliente_sem_id");
  }
  const status = Number(raw.situacao);
  if (
    raw.situacao === null ||
    raw.situacao === undefined ||
    string(raw.situacao) === "" ||
    !Number.isInteger(status) ||
    status < 0 ||
    status > 9
  )
    throw new Error("Situação Olist desconhecida.");
  const invoiceStatus = invoice ? Number(invoice.situacao) : null;
  const invoiceEligible =
    !!invoice &&
    [6, 7].includes(invoiceStatus!) &&
    string(invoice.tipo) === "S" &&
    Number(invoice.finalidade) === 1;
  const order = {
    external_id: externalId,
    external_reference: nullable(
      ecommerce.numeroPedidoCanalVenda || ecommerce.numeroPedidoEcommerce,
    ),
    number: nullable(raw.numeroPedido),
    source_id: sourceId,
    customer_key: `${connectionId}:customer:${customerId || `order:${externalId}`}`,
    customer_name: string(customer.nome) || "Cliente sem identificação",
    state: nullable(
      object(raw.enderecoEntrega).uf || object(customer.endereco).uf,
    ),
    seller: nullable(object(raw.vendedor).nome),
    nature: nullable(object(raw.naturezaOperacao).nome),
    tags: (tags || []).map((v) => string(object(v).descricao)).filter(Boolean),
    sale_date: saleDate(raw.data || raw.dataCriacao),
    invoice_date: invoice?.dataEmissao
      ? saleDate(invoice.dataEmissao)
      : raw.dataFaturamento
        ? saleDate(raw.dataFaturamento)
        : null,
    invoice_id: nullable(raw.idNotaFiscal),
    invoice_status: invoiceStatus,
    invoice_eligible: invoiceEligible,
    status,
    total_cents: decimalUnits(
      string(raw.valorTotalPedido ?? raw.valorTotalProdutos ?? "0"),
      2,
    ).toString(),
    discount_cents: decimalUnits(
      string(raw.valorDesconto ?? "0"),
      2,
    ).toString(),
    fetched_at: fetchedAt,
    quality_flags: [...new Set(quality)],
  };
  return { order, items };
}
