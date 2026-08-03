import { NextResponse } from "next/server";
import { fetchOlistOrders } from "@/lib/olist";
import { getValidTinyToken } from "@/lib/tiny-auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { dateFrom, dateTo } = body;

    if (!dateFrom) {
      return NextResponse.json(
        { error: "Data de início é obrigatória" },
        { status: 400 }
      );
    }

    // First attempt to get a valid token
    const tokenResult = await getValidTinyToken();

    if (tokenResult.status === "expired") {
      return NextResponse.json(
        { 
          error: tokenResult.message || "Sessão expirada. Por favor, reconecte sua conta Tiny ERP.",
          needsReconnect: true,
        },
        { status: 401 }
      );
    }

    if (!tokenResult.token) {
      // At this point status is "valid", "refreshed", or "error" (expired was handled above)
      return NextResponse.json(
        { 
          error: tokenResult.message || "Erro ao obter token de acesso.",
          needsReconnect: false,
        },
        { status: 503 }
      );
    }

    console.log(`[olist] Buscando pedidos no período: ${dateFrom} até ${dateTo || dateFrom} (token status: ${tokenResult.status})`);

    try {
      const orders = await fetchOlistOrders({
        token: tokenResult.token,
        dateFrom,
        dateTo: dateTo || dateFrom,
      });

      console.log(`[olist] Total de pedidos encontrados: ${orders.length}`);

      return NextResponse.json({
        orders,
        total: orders.length,
        fetchedAt: new Date().toISOString(),
      });

    } catch (apiError) {
      // If the API returned 401, the token we got might have just expired
      // Try refreshing once more and retry
      if (apiError instanceof Error && apiError.message.includes("401")) {
        console.warn("[olist] API returned 401. Attempting token refresh and retry...");

        const retryResult = await getValidTinyToken();

        if (!retryResult.token || retryResult.status === "expired") {
          return NextResponse.json(
            { 
              error: "Token expirado. Por favor, reconecte sua conta Tiny ERP.",
              needsReconnect: true,
            },
            { status: 401 }
          );
        }

        // Retry the API call with the fresh token
        const orders = await fetchOlistOrders({
          token: retryResult.token,
          dateFrom,
          dateTo: dateTo || dateFrom,
        });

        console.log(`[olist] Retry successful. Total de pedidos: ${orders.length}`);

        return NextResponse.json({
          orders,
          total: orders.length,
          fetchedAt: new Date().toISOString(),
        });
      }

      // Re-throw non-401 errors
      throw apiError;
    }

  } catch (error) {
    console.error("[olist] API error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Erro interno ao buscar pedidos",
      },
      { status: 500 }
    );
  }
}
