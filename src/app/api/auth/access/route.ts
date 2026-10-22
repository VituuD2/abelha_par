import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { permissionsFor } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const revalidate = 0;

export async function GET() {
  const { access, response: denied } = await authorize();
  const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
  if (denied) { Object.entries(headers).forEach(([name, value]) => denied.headers.set(name, value)); return denied; }
  return NextResponse.json({ userId: access.user.id, role: access.role, permissions: permissionsFor(access.role) }, { headers });
}
