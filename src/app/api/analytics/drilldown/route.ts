import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseABCFilters } from "@/lib/analytics/filters";
import { analyticsError, assertHistoricalCostMigration } from "@/lib/analytics/server";
import { compositionRulesForWorkspace } from "@/lib/analytics/composition-server";
import { decimalUnits, lineCents, unitsDecimal } from "@/lib/analytics/engine";
import type { ABCFilters } from "@/lib/analytics/types";

async function customerOrders(db: ReturnType<typeof createAdminClient>, workspace: string, filters: ABCFilters, entity: string, page: number, direction: "asc" | "desc") {
  const totals = new Map<string, { revenue: bigint; quantity: bigint }>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.rpc("analytics_filtered_items", { p_workspace: workspace, p_filters: filters })
      .select("order_id,quantity::text,gross_cents::text").eq("entity_id", entity).order("order_id").range(offset, offset + 999);
    if (error) throw new Error("Não foi possível consultar os produtos dos pedidos.");
    const lines = data as unknown as { order_id: string; quantity: string; gross_cents: string }[] | null;
    for (const item of lines || []) {
      const total = totals.get(item.order_id) || { revenue: BigInt(0), quantity: BigInt(0) };
      total.revenue += BigInt(item.gross_cents);
      total.quantity += decimalUnits(item.quantity);
      totals.set(item.order_id, total);
    }
    if (!lines || lines.length < 1000) break;
  }
  type Order = {
    id: string; external_id: string; number: string | null; sale_date: string; status: number; total_cents: string;
    company: { name: string }; source: { name: string }; connection: { name: string };
  };
  const orders: Order[] = [], ids = [...totals.keys()];
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await db.from("analytics_orders")
      .select("id,external_id,number,sale_date,status,total_cents::text,company:analytics_companies(name),source:analytics_sources(name),connection:analytics_connections(name)")
      .eq("workspace_id", workspace).in("id", ids.slice(offset, offset + 200));
    if (error) throw new Error("Não foi possível consultar os pedidos deste cliente.");
    orders.push(...(data || []) as unknown as Order[]);
  }
  const ordered = orders.sort((a, b) => (a.sale_date.localeCompare(b.sale_date)
    || a.external_id.localeCompare(b.external_id, "en", { numeric: true }) || a.id.localeCompare(b.id)) * (direction === "asc" ? 1 : -1))
    .slice((page - 1) * 50, page * 50);
  type Item = {
    order_id: string; position: number; quantity: string; unit_price: string; gross_cents: string;
    product: { name: string; sku: string | null };
  };
  const items = new Map<string, { name: string; sku: string; quantity: string; unitPrice: string; subtotal: string }[]>();
  if (ordered.length) for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.from("analytics_items")
      .select("order_id,position,quantity::text,unit_price::text,gross_cents::text,product:analytics_products(name,sku)")
      .eq("workspace_id", workspace).in("order_id", ordered.map(order => order.id))
      .order("order_id").order("position").range(offset, offset + 999);
    if (error) throw new Error("Não foi possível consultar os produtos dos pedidos.");
    for (const item of (data || []) as unknown as Item[]) {
      const products = items.get(item.order_id) || [];
      products.push({ name: item.product.name, sku: item.product.sku || "", quantity: item.quantity,
        unitPrice: lineCents(item.unit_price, "1"), subtotal: item.gross_cents });
      items.set(item.order_id, products);
    }
    if (!data || data.length < 1000) break;
  }
  return ordered.map(order => ({
    id: order.external_id, number: order.number, date: order.sale_date, status: order.status,
    company: order.company.name, source: order.source.name, connection: order.connection.name,
    revenue: totals.get(order.id)!.revenue.toString(), quantity: unitsDecimal(totals.get(order.id)!.quantity),
    total: order.total_cents, items: items.get(order.id) || [],
  }));
}

export async function POST(request: Request) {
  const auth = await authorize("analytics:read");
  if (auth.response) return auth.response;
  try {
    const body = await request.json(),
      filters = parseABCFilters(body.filters),
      page = Number(body.page || 1),
      direction = body.direction ?? "desc";
    if (
      typeof body.entity !== "string" ||
      body.entity.length > 250 ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      !["asc", "desc"].includes(direction)
    )
      throw new Error("Entidade inválida.");
    const composed = filters.grouping === "composition";
    const db = createAdminClient();
    const { data, error } = await db.rpc(
      composed ? "analytics_drilldown_components_v21" : "analytics_drilldown",
      {
        p_workspace: auth.access.workspaceId,
        p_actor: auth.access.user.id,
        p_filters: filters,
        ...(composed ? { p_rules: compositionRulesForWorkspace(auth.access.workspaceId) } : {}),
        p_entity: body.entity,
        p_offset: (page - 1) * 50,
      },
    );
    if (composed) assertHistoricalCostMigration(error);
    if (error)
      throw new Error("Não foi possível abrir os pedidos desta entidade.");
    const result = filters.grouping === "customer" && data.total
      ? { ...data, orders: await customerOrders(db, auth.access.workspaceId, filters, body.entity, page, direction) }
      : data;
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (reason) {
    return analyticsError(reason);
  }
}
