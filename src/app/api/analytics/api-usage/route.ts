import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { olistApiUsage } from "@/lib/olist-api-control";
export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await authorize("integrations:manage");
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await olistApiUsage(auth.access.workspaceId, auth.access.user.id),
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ available: false, error: "Monitor de consumo temporariamente indisponível." },
      { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
