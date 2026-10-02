import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/token-crypto";
import {
  TOKEN_URL,
  verifyAnalyticsState,
  tokenPayload,
} from "@/lib/analytics/auth";
import { AnalyticsApiError, olistRequest } from "@/lib/analytics/olist-client";
import { string } from "@/lib/analytics/normalize";
import {
  analyticsOAuthErrors,
  type AnalyticsOAuthErrorCode,
} from "@/lib/analytics/oauth-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function accountInfo(token: string, connection: string) {
  try {
    return await olistRequest(token, connection, "/info");
  } catch (reason) {
    // Retry a transient account lookup with the SAME token, never exchange
    // the one-use authorization code a second time. Permission errors and
    // rate limits need user action and must not trigger an immediate retry.
    if (!(reason instanceof AnalyticsApiError) || reason.status < 500)
      throw reason;
    await new Promise((resolve) => setTimeout(resolve, 1200));
    return olistRequest(token, connection, "/info");
  }
}

export async function GET(request: Request) {
  const auth = await authorize(true);
  if (auth.response) return auth.response;
  const url = new URL(request.url);
  let stage = "state";
  let db: ReturnType<typeof createAdminClient> | null = null;
  let claimedConnection: { id: string; version: number } | null = null;
  const fail = async (code: AnalyticsOAuthErrorCode, status?: number) => {
    // Log only our own identifiers/codes. Authorization codes, tokens, secrets
    // and provider response bodies never reach logs or the redirect URL.
    console.warn("[analytics-oauth] callback failed", {
      stage,
      code,
      status,
      connection: claimedConnection?.id,
    });
    if (db && claimedConnection) {
      try {
        await db
          .from("analytics_connections")
          .update({ last_error: analyticsOAuthErrors[code] })
          .eq("workspace_id", auth.access.workspaceId)
          .eq("id", claimedConnection.id)
          .eq("version", claimedConnection.version)
          .is("oauth_flow", null)
          .eq("enabled", true)
          .abortSignal(AbortSignal.timeout(3000));
      } catch {
        // A diagnostic write must not replace the actual OAuth failure.
      }
    }
    return NextResponse.redirect(
      new URL(`/ninho?analyticsError=${code}`, url.origin),
      { headers: { "Cache-Control": "no-store" } },
    );
  };
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
    db = createAdminClient();
    stage = "claim";
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
      .eq("credential_kind", "oauth")
      .select("*")
      .abortSignal(AbortSignal.timeout(3000))
      .single();
    if (
      claimed.error ||
      !claimed.data?.client_id ||
      !claimed.data.client_secret
    )
      return fail("authorization");
    const c = claimed.data,
      issued = Date.now();
    claimedConnection = { id: c.id, version: c.version };
    stage = "credentials";
    const secret = decryptToken(c.client_secret);
    stage = "token_request";
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: url.searchParams.get("code")!,
        client_id: c.client_id,
        client_secret: secret,
        redirect_uri: url.origin + "/api/analytics/oauth/callback",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return fail("exchange", response.status);
    stage = "token_response";
    const payload = tokenPayload(data, issued);
    stage = "company_configuration";
    const company = await db
      .from("analytics_companies")
      .select("tax_id")
      .eq("workspace_id", auth.access.workspaceId)
      .eq("id", c.company_id)
      .abortSignal(AbortSignal.timeout(3000))
      .single();
    if (company.error || !/^\d{14}$/.test(company.data?.tax_id || ""))
      return fail("company_configuration");
    stage = "account";
    const info = await accountInfo(data.access_token, c.id),
      tax = string(info.cpfCnpj).replace(/\D/g, "");
    if (!/^\d{14}$/.test(tax)) return fail("account_response");
    if (tax !== company.data.tax_id)
      return fail("company");
    stage = "save";
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
      .eq("enabled", true)
      .is("oauth_flow", null)
      .select("id")
      .abortSignal(AbortSignal.timeout(3000))
      .single();
    if (saved.error) return fail("save");
    return NextResponse.redirect(
      new URL("/ninho?analyticsConnected=1", url.origin),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (reason) {
    if (stage === "account") {
      if (reason instanceof AnalyticsApiError) {
        const code =
          reason.status === 403
            ? "account_permission"
            : reason.status === 401
              ? "account_authorization"
              : reason.status === 429
                ? "account_rate_limit"
                : reason.status >= 500
                  ? "account_unavailable"
                  : "account_response";
        return fail(code, reason.status);
      }
      return fail("account_response");
    }
    if (
      stage === "credentials" ||
      stage === "token_request" ||
      stage === "token_response" ||
      stage === "company_configuration" ||
      stage === "save"
    )
      return fail(stage);
    return fail("configuration");
  }
}
