import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { cacheNuvemshopOrders, getNuvemshopConnection, normalizeNuvemshopOrder, nuvemshopRequest, NuvemshopError } from "@/lib/nuvemshop";
import { isValidDateRange } from "@/lib/dates";

export async function GET(request: Request) {
  const { access, response: denied } = await authorize();
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const from = params.get("from") || "", to = params.get("to") || "", mode = params.get("mode") || "updated";
  const page = Number(params.get("page") || "1");
  if (!isValidDateRange(from, to) || !["created", "updated"].includes(mode) || !Number.isInteger(page) || page < 1 || page > 100) return NextResponse.json({ error: "Informe um período válido de até 31 dias." }, { status: 400 });
  try {
    const connection = await getNuvemshopConnection(access.workspaceId);
    if (!connection) return NextResponse.json({ error: "A conexão Nuvemshop precisa ser revisada pelo administrador no Ninho." }, { status: 409 });
    const query = new URLSearchParams({ page: String(page), per_page: "100", status: "any", [`${mode}_at_min`]: `${from}T00:00:00-03:00`, [`${mode}_at_max`]: `${to}T23:59:59.999-03:00` });
    const response = await nuvemshopRequest(connection.storeId, connection.token, `/orders?${query}`, request.signal);
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) throw new NuvemshopError("A Nuvemshop retornou uma lista inválida.");
    const orders = payload.map(value => normalizeNuvemshopOrder(value, connection.storeId));
    await cacheNuvemshopOrders(access.workspaceId, orders);
    const totalHeader = response.headers.get("x-total-count");
    const total = totalHeader !== null ? Number(totalHeader) : null;
    const hasMore = response.headers.has("link") ? /rel=["']?next/.test(response.headers.get("link") || "") : total !== null && Number.isFinite(total) ? page * 100 < total : orders.length === 100;
    return NextResponse.json({ orders, hasMore, page, storeId: connection.storeId, fetchedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof NuvemshopError ? error.status : 502;
    const retry = error instanceof NuvemshopError ? error.retryAfterSeconds : undefined;
    return NextResponse.json({ error: error instanceof NuvemshopError ? error.message : "A consulta demorou ou a conexão falhou. Tente novamente.", retryAfterSeconds: retry }, { status, ...(retry ? { headers: { "Retry-After": String(retry) } } : {}) });
  }
}
