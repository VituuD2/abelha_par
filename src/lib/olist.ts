import { extractYampiId } from "./regex";
import type { OlistApiOrder, OlistOrder } from "@/types";

const API_BASE = "https://api.tiny.com.br/public-api/v3";

interface FetchOrdersParams {
  token: string;
  dateFrom: string;
  dateTo?: string;
}

/**
 * Fetches all orders from Olist/Tiny API for a given date range.
 * Paginates automatically to get all results.
 */
export async function fetchOlistOrders({
  token,
  dateFrom,
  dateTo,
}: FetchOrdersParams): Promise<OlistOrder[]> {
  const allOrders: OlistOrder[] = [];
  let currentPage = 1;
  let totalPages = 1;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  while (currentPage <= totalPages) {
    const params = new URLSearchParams({
      dataAtualizacao: dateFrom,
      limite: "100",
      pagina: String(currentPage),
    });

    if (dateTo) {
      params.set("dataAtualizacaoFim", dateTo);
    }

    const response = await fetch(`${API_BASE}/pedidos?${params.toString()}`, {
      headers,
    });

    if (!response.ok) {
      throw new Error(
        `Olist API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const items = data.itens || [];
    
    if (data.paginacao) {
      totalPages = data.paginacao.paginas || 1;
    }

    // Filter items to only include WooCommerce orders (id: 20161) if ecommerce data is available in the list
    const wooCommerceItems = items.filter((item: any) => {
      if (item.ecommerce) {
        return item.ecommerce.id === 20161 || String(item.ecommerce.nome).toLowerCase() === "woocommerce";
      }
      return true; // If ecommerce info is missing in the list endpoint, keep it and check later
    });

    // For each order, fetch details to get observacoes
    for (const item of wooCommerceItems) {
      try {
        const detail = await fetchOrderDetail(item.id, headers);

        // Fallback filter: if list didn't have ecommerce info, check it at the detail level
        if (detail.ecommerce && detail.ecommerce.id !== 20161 && String(detail.ecommerce.nome).toLowerCase() !== "woocommerce") {
          continue;
        }

        const yampiId = extractYampiId(
          `${detail.observacoes || ""} ${detail.observacao_interna || ""}`
        );

        allOrders.push({
          id: detail.id,
          yampiId,
          trackingCode: detail.codigo_rastreamento || "",
          clientName: detail.nome || "",
          numeroPedido: detail.numero,
        });
      } catch (err) {
        console.error(`Failed to fetch detail for order ${item.id}:`, err);
        // Still add with basic info
        allOrders.push({
          id: item.id,
          yampiId: null,
          trackingCode: item.codigo_rastreamento || "",
          clientName: item.nome || "",
          numeroPedido: item.numero,
        });
      }
    }

    currentPage++;
  }

  return allOrders;
}

async function fetchOrderDetail(
  orderId: number,
  headers: Record<string, string>
): Promise<OlistApiOrder> {
  const response = await fetch(`${API_BASE}/pedidos/${orderId}`, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch order ${orderId}: ${response.status}`);
  }

  return response.json();
}
