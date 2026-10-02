import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnalyticsState } from "@/lib/analytics/auth";
import { analyticsError } from "@/lib/analytics/server";
import type { AnalyticsConnection } from "@/lib/analytics/types";
export async function GET(request: Request) {
  const auth = await authorize(true);
  if (auth.response) return auth.response;
  try {
    const url = new URL(request.url),
      db = createAdminClient();
    const { data, error } = await db
      .from("analytics_connections")
      .select("*")
      .eq("workspace_id", auth.access.workspaceId)
      .eq("id", url.searchParams.get("connection"))
      .single();
    if (
      error ||
      !data?.enabled ||
      data.credential_kind !== "oauth" ||
      !data.client_id ||
      !data.client_secret
    )
      throw new Error("Configure o aplicativo desta conexão no Ninho.");
    const { state, payload } = createAnalyticsState(
      auth.access.user.id,
      data as AnalyticsConnection,
    );
    const saved = await db
      .from("analytics_connections")
      .update({
        oauth_flow: payload.flow,
        oauth_expires_at: new Date(payload.expires).toISOString(),
      })
      .eq("workspace_id", auth.access.workspaceId)
      .eq("id", data.id)
      .eq("version", data.version)
      .select("id")
      .single();
    if (saved.error) throw new Error("Não foi possível iniciar a autorização.");
    const endpoint = new URL(
      "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth",
    );
    endpoint.search = new URLSearchParams({
      client_id: data.client_id,
      redirect_uri: url.origin + "/api/analytics/oauth/callback",
      response_type: "code",
      scope: "openid",
      state,
      prompt: "login",
    }).toString();
    return NextResponse.redirect(endpoint);
  } catch (e) {
    return analyticsError(e);
  }
}
