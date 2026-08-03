import { NextResponse } from "next/server";
import { getValidTinyToken } from "@/lib/tiny-auth";
import { testTinyConnection } from "@/lib/olist";

export async function GET() {
  try {
    const result = await getValidTinyToken();
    
    // If no token available, report disconnected
    if (!result.token) {
      return NextResponse.json({
        isConnected: false,
        needsReconnect: result.status === "expired",
        status: result.status,
        message: result.message || null,
      });
    }

    // We have a token — verify it actually works by hitting the API
    const connectionTest = await testTinyConnection(result.token);

    if (connectionTest.ok) {
      return NextResponse.json({
        isConnected: true,
        needsReconnect: false,
        status: result.status,
        message: null,
      });
    }

    // Token exists but API rejects it
    console.warn(`[auth/status] Token exists but API rejected it: ${connectionTest.status} ${connectionTest.detail}`);

    if (connectionTest.status === 401 || connectionTest.status === 403) {
      // Token is invalid — need re-auth
      return NextResponse.json({
        isConnected: false,
        needsReconnect: true,
        status: "expired",
        message: "Token inválido. Por favor, reconecte sua conta Tiny ERP.",
      });
    }

    // Other API errors (rate limit, server error) — token might still be valid
    return NextResponse.json({
      isConnected: true, // Assume connected, just API hiccup
      needsReconnect: false,
      status: "valid",
      message: `API retornou ${connectionTest.status}. Token pode estar válido.`,
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
