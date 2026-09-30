import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptToken } from "@/lib/token-crypto";
import { getNuvemshopConnection, nuvemshopRequest, NuvemshopError } from "@/lib/nuvemshop";

export async function GET() {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const connection = await getNuvemshopConnection(user.id);
    return NextResponse.json({ connected: Boolean(connection), storeId: connection?.storeId || process.env.NUVEMSHOP_STORE_ID || "", mapping: connection?.mapping || null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    const storeId = String(body.storeId || "").trim();
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!/^\d{1,20}$/.test(storeId) || !token || token.length > 4096) return NextResponse.json({ error: "Informe o ID da loja e um token válido." }, { status: 400 });
    await nuvemshopRequest(storeId, token, "/orders?per_page=1&page=1", request.signal);
    const { error } = await createAdminClient().from("nuvemshop_integrations").upsert({ owner_id: user.id, store_id: storeId, access_token: encryptToken(token), olist_ecommerce_id: null, reference_kind: null, reference_field: null, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
    if (error) throw new NuvemshopError("Não foi possível salvar a conexão. Verifique se a atualização do banco foi aplicada.", 503);
    return NextResponse.json({ connected: true, storeId });
  } catch (error) { return failure(error); }
}

export async function PATCH(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!Number.isSafeInteger(body.ecommerceId) || body.ecommerceId <= 0 || !["id", "number"].includes(body.referenceKind)
      || !["ecommerceOrderNumber", "ecommerceChannelOrderNumber"].includes(body.referenceField)) return NextResponse.json({ error: "Configuração de vínculo inválida." }, { status: 400 });
    const { data, error } = await createAdminClient().from("nuvemshop_integrations").update({ olist_ecommerce_id: body.ecommerceId, reference_kind: body.referenceKind, reference_field: body.referenceField, updated_at: new Date().toISOString() }).eq("owner_id", user.id).select("store_id").maybeSingle();
    if (error || !data) throw new NuvemshopError("Conecte a loja antes de configurar o vínculo.", 409);
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error); }
}

function failure(error: unknown) {
  if (error instanceof SyntaxError) return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  return NextResponse.json({ error: error instanceof NuvemshopError ? error.message : "Falha ao configurar a conexão Nuvemshop." }, { status: error instanceof NuvemshopError ? error.status : 502 });
}
