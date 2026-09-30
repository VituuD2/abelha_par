import { NextResponse } from "next/server";
import { getAuthenticatedUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getNuvemshopConnection } from "@/lib/nuvemshop";
import { normalizeResponsible } from "@/lib/responsible";
import { reconcileOrders, normalizeExternalReference } from "@/lib/reconciliation";
import { readScanSession, SESSION_FIELDS, UUID } from "@/lib/scan-session-server";
import { fromOlistCache, OLIST_CACHE_FIELDS } from "@/lib/olist-sync";
import type { NuvemshopOrder } from "@/types";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Seleção inválida." }, { status: 400 });
    const responsible = normalizeResponsible(body.responsible);
    const validIds = (ids: unknown): ids is number[] => Array.isArray(ids) && ids.length > 0 && ids.length <= 1000 && ids.every(id => Number.isSafeInteger(id) && id > 0) && new Set(ids).size === ids.length;
    if (!UUID.test(body.id || "") || !responsible || !validIds(body.nuvemshopIds) || !validIds(body.olistIds)) return NextResponse.json({ error: "Seleção ou responsável inválido. O lote aceita até 1.000 pedidos." }, { status: 400 });
    const existing = await readScanSession(user.id, body.id);
    if (existing) return NextResponse.json({ session: existing });
    const connection = await getNuvemshopConnection(user.id);
    if (!connection?.mapping) return NextResponse.json({ error: "Configure o vínculo da Nuvemshop com a Olist antes de iniciar." }, { status: 409 });
    const db = createAdminClient();
    const nuvem = await db.from("nuvemshop_order_cache").select("payload, fetched_at").eq("owner_id", user.id).eq("store_id", connection.storeId).in("order_id", body.nuvemshopIds);
    if (nuvem.error) throw new Error("Não foi possível validar os pedidos no servidor.");
    const selected = nuvem.data.map(row => row.payload as NuvemshopOrder);
    const references = selected.map(order => normalizeExternalReference(connection.mapping!.referenceKind === "id" ? order.id : order.number));
    // Derive candidates from server data, so omitting an ambiguous candidate in
    // the client request cannot authorize a different matching decision.
    const field = connection.mapping.referenceField === "ecommerceOrderNumber" ? "ecommerce_order_number" : "ecommerce_channel_order_number";
    const olist = await db.from("olist_order_cache").select(OLIST_CACHE_FIELDS, { count: "exact" }).eq("owner_id", user.id).eq("ecommerce_id", connection.mapping.ecommerceId).in(field, references).limit(1000);
    if (nuvem.error || olist.error) throw new Error("Não foi possível validar os pedidos no servidor.");
    if ((olist.count || 0) > 1000) return NextResponse.json({ error: "Há correspondências demais para a seleção. Reduza o lote e revise possíveis pedidos duplicados na Olist." }, { status: 409 });
    const cutoff = Date.now() - 2 * 60 * 60_000;
    if (nuvem.data.length !== body.nuvemshopIds.length || body.olistIds.some((id: number) => !olist.data.some(row => row.olist_order_id === id))
      || nuvem.data.some(row => Date.parse(row.fetched_at) < cutoff) || olist.data.some(row => Date.parse(row.resolved_at) < cutoff)) return NextResponse.json({ error: "Os dados da seleção expiraram ou estão incompletos. Atualize as buscas nas duas plataformas." }, { status: 409 });
    const result = reconcileOrders(selected, olist.data.map(fromOlistCache), connection.mapping);
    if (result.issues.length || result.orders.length !== body.nuvemshopIds.length) return NextResponse.json({ error: "Existem divergências na seleção. Atualize as buscas e revise o cruzamento.", issues: result.issues }, { status: 409 });
    const { data, error } = await db.from("scan_sessions").insert({ id: body.id, owner_id: user.id, responsible, orders: result.orders }).select(SESSION_FIELDS).single();
    if (error?.code === "23505") return NextResponse.json({ session: await readScanSession(user.id, body.id) });
    if (error) throw new Error("Não foi possível criar o lote. Verifique a atualização do banco e tente novamente.");
    return NextResponse.json({ session: data }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof SyntaxError ? "JSON inválido" : error instanceof Error ? error.message : "Falha ao iniciar conferência." }, { status: error instanceof SyntaxError ? 400 : 503 }); }
}
