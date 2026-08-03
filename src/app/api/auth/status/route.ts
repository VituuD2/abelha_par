import { NextResponse } from "next/server";
import { getValidTinyToken } from "@/lib/tiny-auth";

export async function GET() {
  try {
    const result = await getValidTinyToken();
    
    return NextResponse.json({
      isConnected: result.status === "valid" || result.status === "refreshed",
      needsReconnect: result.status === "expired",
      status: result.status,
      message: result.message || null,
    });
  } catch (error) {
    console.error("Error checking auth status:", error);
    return NextResponse.json(
      { 
        isConnected: false, 
        needsReconnect: false,
        status: "error",
        message: "Erro ao verificar status da conexão.",
      },
      { status: 500 }
    );
  }
}
