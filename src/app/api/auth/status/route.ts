import { NextResponse } from "next/server";
import { getValidTinyToken } from "@/lib/tiny-auth";

export async function GET() {
  try {
    const token = await getValidTinyToken();
    
    return NextResponse.json({
      isConnected: !!token,
    });
  } catch (error) {
    console.error("Error checking auth status:", error);
    return NextResponse.json(
      { isConnected: false, error: "Failed to check status" },
      { status: 500 }
    );
  }
}
