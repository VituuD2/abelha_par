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
      data_inicial: dateFrom,
      limite: "100",
      pagina: String(currentPage),
    });

    if (dateTo) {
      params.set("data_final", dateTo);
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

    if (wooCommerceItems.length > 0) {
      console.log("=== LOG DE UM ITEM BRUTO DA LISTA ===");
      console.dir(wooCommerceItems[0], { depth: null });
      console.log("======================================");
    }

    // For each order, fetch details to get observacoes
    for (const item of wooCommerceItems) {
      // First, try to get the ID directly from the list item to avoid hitting the API rate limit (429)
      let yampiId = null;
      const numero = item.numero_pedido || item.numero;
      const numero_ecommerce = item.numero_ecommerce || (item.ecommerce && item.ecommerce.numeroPedidoEcommerce);
      const clientName = item.cliente?.nome || item.nome || "";
      
      if (numero_ecommerce) {
        yampiId = String(numero_ecommerce).trim();
      } else if (numero) {
        yampiId = String(numero).trim();
      }

      // Se já temos um ID, podemos pular a busca de detalhes e economizar cota da API!
      if (yampiId) {
        allOrders.push({
          id: item.id,
          yampiId,
          trackingCode: item.codigo_rastreamento || "",
          clientName,
          numeroPedido: numero,
        });
        continue;
      }

      // Se realmente precisamos dos detalhes, buscamos com cuidado
      try {
        const detail = await fetchOrderDetail(item.id, headers);

        // Fallback filter: if list didn't have ecommerce info, check it at the detail level
        if (detail.ecommerce && detail.ecommerce.id !== 20161 && String(detail.ecommerce.nome).toLowerCase() !== "woocommerce") {
          continue;
        }

        yampiId = extractYampiId(
          `${detail.observacoes || ""} ${detail.observacao_interna || ""}`
        );

        if (!yampiId && detail.numero_ecommerce) {
          yampiId = String(detail.numero_ecommerce).trim();
        }

        if (!yampiId && detail.numero) {
          yampiId = String(detail.numero).trim();
        }

        allOrders.push({
          id: detail.id,
          yampiId,
          trackingCode: detail.codigo_rastreamento || "",
          clientName: detail.cliente?.nome || detail.nome || clientName,
          numeroPedido: detail.numero_pedido || detail.numero || numero,
        });

        // Delay para evitar 429 Too Many Requests
        await new Promise((resolve) => setTimeout(resolve, 350));
      } catch (err) {
        console.error(`Failed to fetch detail for order ${item.id}:`, err);
        // Still add with basic info
        allOrders.push({
          id: item.id,
          yampiId: null,
          trackingCode: item.codigo_rastreamento || "",
          clientName,
          numeroPedido: numero,
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
