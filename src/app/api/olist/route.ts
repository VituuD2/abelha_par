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

    const orders = await fetchOlistOrders({
      token: apiToken,
      dateFrom,
      dateTo: dateTo || dateFrom,
    });

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
