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

    const apiToken = await getValidTinyToken();

    if (!apiToken) {
      return NextResponse.json(
        { error: "Não conectado ao Tiny ERP. Por favor, conecte sua conta primeiro." },
        { status: 401 }
      );
    }

    console.log(`Buscando pedidos Olist/Tiny no período: ${dateFrom} até ${dateTo || dateFrom}`);

    const orders = await fetchOlistOrders({
      token: apiToken,
      dateFrom,
      dateTo: dateTo || dateFrom,
    });

    console.log("=== LOG DE PEDIDOS BUSCADOS DA API (Tiny) ===");
    console.log(`Total de pedidos encontrados: ${orders.length}`);
    if (orders.length > 0) {
      console.log("Exemplo dos primeiros 5 pedidos (para verificação de ID):");
      console.dir(orders.slice(0, 5), { depth: null });
    }
    console.log("===============================================");

    return NextResponse.json({
      orders,
      total: orders.length,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Olist API error:", error);
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
