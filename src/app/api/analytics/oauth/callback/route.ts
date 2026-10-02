import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/token-crypto";
import {
  TOKEN_URL,
  verifyAnalyticsState,
  tokenPayload,
} from "@/lib/analytics/auth";
import { olistRequest } from "@/lib/analytics/olist-client";
import { string } from "@/lib/analytics/normalize";
export async function GET(request: Request) {
  const auth = await authorize(true);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  const fail = (code: string) =>
    NextResponse.redirect(new URL(`/ninho?analyticsError=${code}`, url.origin));
  try {
    const state = verifyAnalyticsState(
      url.searchParams.get("state") || "",
      auth.access.user.id,
      auth.access.workspaceId,
    );
    if (
      !state ||
      url.searchParams.has("error") ||
      !url.searchParams.get("code")
    )
      return fail("authorization");
    const db = createAdminClient();
    // Consume the one-use flow before exchanging its code. Replay never reaches the provider.
    const claimed = await db
      .from("analytics_connections")
      .update({ oauth_flow: null, oauth_expires_at: null })
      .eq("workspace_id", auth.access.workspaceId)
      .eq("id", state.connection)
      .eq("version", state.version)
      .eq("oauth_flow", state.flow)
      .gt("oauth_expires_at", new Date().toISOString())
      .eq("enabled", true)
      .select("*")
      .single();
    if (
      claimed.error ||
      !claimed.data?.client_id ||
      !claimed.data.client_secret
    )
      return fail("authorization");
    const c = claimed.data,
      issued = Date.now();
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: url.searchParams.get("code")!,
        client_id: c.client_id,
        client_secret: decryptToken(c.client_secret),
        redirect_uri: url.origin + "/api/analytics/oauth/callback",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return fail("exchange");
    const payload = tokenPayload(data, issued);
    const company = await db
      .from("analytics_companies")
      .select("tax_id")
      .eq("workspace_id", auth.access.workspaceId)
      .eq("id", c.company_id)
      .single();
    const info = await olistRequest(data.access_token, c.id, "/info"),
      tax = string(info.cpfCnpj).replace(/\D/g, "");
    if (company.error || !company.data?.tax_id || tax !== company.data.tax_id)
      return fail("company");
    const saved = await db
      .from("analytics_connections")
      .update({
        ...payload,
        verified_tax_id: tax,
        verified_at: new Date().toISOString(),
        version: c.version + 1,
        last_error: null,
      })
      .eq("workspace_id", auth.access.workspaceId)
      .eq("id", c.id)
      .eq("version", c.version)
      .select("id")
      .single();
    if (saved.error) return fail("save");
    return NextResponse.redirect(
      new URL("/ninho?analyticsConnected=1", url.origin),
    );
  } catch {
    return fail("configuration");
  }
}
