import { extractYampiId } from "./regex";
import type { OlistOrder } from "@/types";

const API_BASE = "https://api.tiny.com.br/public-api/v3";

interface FetchOrdersParams {
  token: string;
  dateFrom: string;
  dateTo?: string;
}

/**
 * Tests if the given token is valid by making a lightweight API call.
 * Returns true if the API accepts the token, false otherwise.
 */
export async function testTinyConnection(token: string): Promise<{ ok: boolean; status: number; detail?: string }> {
  try {
    // Use the company info endpoint as a lightweight test
    const response = await fetch(`${API_BASE}/info`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (response.ok) {
      return { ok: true, status: response.status };
    }

    const errorText = await response.text().catch(() => "");
    return { ok: false, status: response.status, detail: errorText };
  } catch (err) {
    return { ok: false, status: 0, detail: err instanceof Error ? err.message : "Network error" };
  }
}

/**
 * Fetches all orders from Olist/Tiny API v3 for a given date range.
 * Uses limit/offset pagination as per the official API docs.
 * 
 * API v3 parameters (camelCase):
 * - dataInicial, dataFinal (date filters)
 * - limit (default 100, max 100)
 * - offset (pagination offset)
 */
export async function fetchOlistOrders({
  token,
  dateFrom,
  dateTo,
}: FetchOrdersParams): Promise<OlistOrder[]> {
  const allOrders: OlistOrder[] = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  while (hasMore) {
    const params = new URLSearchParams({
      dataInicial: dateFrom,
      limit: String(limit),
      offset: String(offset),
    });

    if (dateTo) {
      params.set("dataFinal", dateTo);
    }

    console.log(`[olist] Fetching orders: offset=${offset}, limit=${limit}`);

    const response = await fetch(`${API_BASE}/pedidos?${params.toString()}`, {
      headers,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      console.error(`[olist] API error ${response.status}: ${errorBody}`);
      throw new Error(
        `Olist API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const items = data.itens || [];

    // API v3 pagination: { limit, offset, total }
    const pagination = data.paginacao;
    const total = pagination?.total || 0;

    console.log(`[olist] Got ${items.length} items (offset=${offset}, total=${total})`);

    // Filter items to only include WooCommerce orders (id: 20161) if ecommerce data is available
    const wooCommerceItems = items.filter((item: any) => {
      if (item.ecommerce) {
        return item.ecommerce.id === 20161 || String(item.ecommerce.nome).toLowerCase() === "woocommerce";
      }
      return true; // If ecommerce info is missing, keep it and check later
    });

    if (wooCommerceItems.length > 0 && offset === 0) {
      console.log("=== LOG DE UM ITEM BRUTO DA LISTA ===");
      console.dir(wooCommerceItems[0], { depth: null });
      console.log("======================================");
    }

    // Process each order
    for (const item of wooCommerceItems) {
      let yampiId = null;
      // API v3 uses camelCase field names
      const numero = item.numeroPedido || item.numero;
      const numero_ecommerce = item.ecommerce?.numeroPedidoEcommerce;
      const clientName = item.cliente?.nome || "";
      const trackingCode = item.transportador?.codigoRastreamento || "";

      if (numero_ecommerce) {
        yampiId = String(numero_ecommerce).trim();
      } else if (numero) {
        yampiId = String(numero).trim();
      }

      // If we already have an ID, skip detail fetch
      if (yampiId) {
        allOrders.push({
          id: item.id,
          yampiId,
          trackingCode,
          clientName,
          numeroPedido: numero,
        });
        continue;
      }

      // If we really need details, fetch them
      try {
        const detail = await fetchOrderDetail(item.id, headers);

        // Fallback filter for ecommerce
        if (detail.ecommerce && detail.ecommerce.id !== 20161 && String(detail.ecommerce.nome).toLowerCase() !== "woocommerce") {
          continue;
        }

        yampiId = extractYampiId(
          `${detail.observacoes || ""} ${detail.observacaoInterna || ""}`
        );

        if (!yampiId && detail.ecommerce?.numeroPedidoEcommerce) {
          yampiId = String(detail.ecommerce.numeroPedidoEcommerce).trim();
        }

        if (!yampiId && detail.numeroPedido) {
          yampiId = String(detail.numeroPedido).trim();
        }

        allOrders.push({
          id: detail.id,
          yampiId,
          trackingCode: detail.transportador?.codigoRastreamento || trackingCode,
          clientName: detail.cliente?.nome || clientName,
          numeroPedido: detail.numeroPedido || numero,
        });

        // Delay to avoid 429 Too Many Requests
        await new Promise((resolve) => setTimeout(resolve, 350));
      } catch (err) {
        console.error(`Failed to fetch detail for order ${item.id}:`, err);
        allOrders.push({
          id: item.id,
          yampiId: null,
          trackingCode,
          clientName,
          numeroPedido: numero,
        });
      }
    }

    // Advance pagination
    offset += limit;
    hasMore = offset < total;
  }

  return allOrders;
}

async function fetchOrderDetail(
  orderId: number,
  headers: Record<string, string>
): Promise<any> {
  const response = await fetch(`${API_BASE}/pedidos/${orderId}`, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch order ${orderId}: ${response.status}`);
  }

  return response.json();
}
