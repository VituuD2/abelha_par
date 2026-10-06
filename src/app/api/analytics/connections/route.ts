import { NextResponse } from "next/server";
import { authorize } from "@/lib/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/token-crypto";
import { createHash } from "crypto";
import { getValidTinyToken } from "@/lib/tiny-auth";
import { analyticsToken } from "@/lib/analytics/auth";
import { olistRequest } from "@/lib/analytics/olist-client";
import { object, string } from "@/lib/analytics/normalize";
import { analyticsError, analyticsStatus } from "@/lib/analytics/server";
export const dynamic = "force-dynamic";
export async function GET() {
  const auth = await authorize(true);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(
      await analyticsStatus(auth.access.workspaceId, auth.access.user.id),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return analyticsError(e, 503);
  }
}
export async function POST(request: Request) {
  const auth = await authorize(true);
  if (auth.response) return auth.response;
  const db = createAdminClient(),
    workspace = auth.access.workspaceId;
  try {
    const b = await request.json();
    if (b.action === "company") {
      const name = string(b.name),
        tax = string(b.taxId).replace(/\D/g, "");
      if (!name || name.length > 120 || !/^\d{14}$/.test(tax))
        throw new Error("Informe nome e CNPJ com 14 dígitos.");
      if (b.id) {
        const verified = await db
          .from("analytics_connections")
          .select("verified_tax_id")
          .eq("workspace_id", workspace)
          .eq("company_id", b.id)
          .not("verified_tax_id", "is", null);
        if (
          verified.error ||
          verified.data?.some((c) => c.verified_tax_id !== tax)
        )
          throw new Error(
            "O CNPJ está vinculado a uma conta já validada. Cadastre outra empresa para um CNPJ diferente.",
          );
      }
      const result = b.id
        ? await db
            .from("analytics_companies")
            .update({ name, tax_id: tax })
            .eq("workspace_id", workspace)
            .eq("id", b.id)
            .select("id")
            .single()
        : await db
            .from("analytics_companies")
            .insert({ workspace_id: workspace, name, tax_id: tax })
            .select("id")
            .single();
      if (result.error)
        throw new Error(
          "Não foi possível salvar a empresa. Verifique se o CNPJ já está cadastrado.",
        );
      return NextResponse.json({ id: result.data.id });
    }
    if (b.action === "create") {
      const company = await db
        .from("analytics_companies")
        .select("id,tax_id")
        .eq("workspace_id", workspace)
        .eq("id", b.company)
        .single();
      if (company.error || !company.data?.tax_id)
        throw new Error("Empresa não autorizada ou sem CNPJ.");
      const name = string(b.name),
        clientId = string(b.clientId),
        secret = string(b.clientSecret);
      if (
        !name ||
        name.length > 120 ||
        !clientId ||
        clientId.length > 200 ||
        !secret ||
        secret.length > 2000
      )
        throw new Error(
          "Informe nome, client_id e client_secret do aplicativo privado.",
        );
      const result = await db
        .from("analytics_connections")
        .insert({
          workspace_id: workspace,
          company_id: company.data.id,
          name,
          client_id: clientId,
          client_secret: encryptToken(secret),
        })
        .select("id")
        .single();
      if (result.error) throw new Error("Não foi possível criar a conexão.");
      return NextResponse.json({ id: result.data.id });
    }
    if (b.action === "source") {
      if (
        !["unknown", "marketplace", "site", "direct", "other"].includes(
          b.kind,
        ) ||
        [b.marketplace, b.store, b.account].some(
          (v) => typeof v !== "string" || v.length > 160,
        )
      )
        throw new Error("Classificação de origem inválida.");
      const current = await db
        .from("analytics_sources")
        .select("external_account")
        .eq("workspace_id", workspace)
        .eq("id", b.id)
        .single();
      if (current.error) throw new Error("Origem não autorizada.");
      // Account changes are explicit reconciliation, never a silent merge based on labels.
      if ((current.data.external_account || "") !== b.account) {
        const used = await db
          .from("analytics_orders")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspace)
          .eq("source_id", b.id);
        if (used.error)
          throw new Error("Não foi possível verificar as vendas da origem.");
        if (used.count) {
          if (b.confirmAccount !== true || !b.account)
            throw new Error(
              "Confirme a identidade externa comprovada para reconciliar as vendas existentes. Uma conta canônica já usada não pode ser removida sem recuperar as origens arquivadas.",
            );
          const reconciled = await db.rpc("analytics_reconcile_source", {
            p_workspace: workspace,
            p_actor: auth.access.user.id,
            p_source: b.id,
            p_kind: b.kind,
            p_marketplace: b.marketplace,
            p_store: b.store,
            p_account: b.account,
          });
          if (reconciled.error)
            throw new Error(
              "Não foi possível reconciliar a origem. Nenhuma alteração foi aplicada.",
            );
          return NextResponse.json({ ok: true, merged: reconciled.data });
        }
      }
      const result = await db
        .from("analytics_sources")
        .update({
          kind: b.kind,
          marketplace: b.marketplace || null,
          store: b.store || null,
          external_account: b.account || null,
        })
        .eq("workspace_id", workspace)
        .eq("id", b.id)
        .select("id")
        .single();
      if (result.error)
        throw new Error("Não foi possível classificar a origem.");
      return NextResponse.json({ ok: true });
    }
    const current = await db
      .from("analytics_connections")
      .select("id,company_id,credential_kind,version")
      .eq("workspace_id", workspace)
      .eq("id", b.id)
      .single();
    if (current.error) throw new Error("Conexão não autorizada.");
    if (b.action === "relink") {
      if (current.data.credential_kind !== "legacy")
        throw new Error("Esta conta usa autorização própria. Reconecte esta conta pela ação de autorização.");
      const result = await getValidTinyToken(workspace);
      if (!result.token)
        throw new Error("Reconecte a Olist operacional no Ninho antes de restabelecer o vínculo.");
      const integration = await db.from("tiny_integrations")
        .select("id,access_token").eq("workspace_id", workspace).single();
      if (integration.error || decryptToken(integration.data.access_token) !== result.token)
        throw new Error("A integração operacional mudou. Tente restabelecer o vínculo novamente.");
      const info = await olistRequest(result.token, current.data.id, "/info");
      const tax = string(info.cpfCnpj).replace(/\D/g, "");
      if (!/^\d{14}$/.test(tax))
        throw new Error("Libere Informações da conta no aplicativo Olist para validar o CNPJ antes de restabelecer o vínculo.");
      const saved = await db.rpc("analytics_relink_legacy", {
        p_workspace: workspace, p_actor: auth.access.user.id,
        p_connection: current.data.id, p_version: current.data.version,
        p_integration: integration.data.id, p_access_token: integration.data.access_token,
        p_tax: tax, p_fingerprint: createHash("sha256").update(result.token).digest("hex"),
      });
      if (saved.error)
        throw new Error(saved.error.message.includes("CNPJ_MISMATCH")
          ? "O CNPJ da Olist operacional difere da empresa cadastrada. O vínculo e o histórico foram preservados."
          : "Não foi possível restabelecer o vínculo. Aguarde o lote atual e confira a migração v12.");
      return NextResponse.json({ ok: true });
    }
    if (b.action === "verify") {
      const token = await analyticsToken(workspace, current.data.id),
        info = await olistRequest(token, current.data.id, "/info");
      const tax = string(info.cpfCnpj).replace(/\D/g, "");
      if (!/^\d{14}$/.test(tax))
        throw new Error(
          "A API não retornou o CNPJ da conta. Confira a permissão Informações da conta.",
        );
      const company = await db
        .from("analytics_companies")
        .select("tax_id")
        .eq("workspace_id", workspace)
        .eq("id", current.data.company_id)
        .single();
      if (company.error || (company.data.tax_id && company.data.tax_id !== tax))
        throw new Error("O CNPJ da conta Olist difere da empresa cadastrada.");
      const saved = await db
        .from("analytics_connections")
        .update({ verified_tax_id: tax, verified_at: new Date().toISOString(), last_error: null, error_code: null })
        .eq("workspace_id", workspace)
        .eq("id", b.id)
        .eq("version", current.data.version)
        .select("id")
        .single();
      if (saved.error)
        throw new Error("A conexão mudou durante a verificação.");
      return NextResponse.json({
        verifiedTaxId: tax,
        companyName: string(object(info).razaoSocial),
      });
    }
    if (
      b.action !== "pause" &&
      b.action !== "resume" &&
      b.action !== "credentials"
    )
      throw new Error("Ação inválida.");
    let patch: Record<string, unknown> = { enabled: b.action === "resume" };
    if (b.action === "credentials") {
      if (current.data.credential_kind === "legacy")
        throw new Error(
          "Altere o aplicativo da conexão atual pela configuração operacional existente.",
        );
      if (
        !string(b.clientId) ||
        !string(b.clientSecret) ||
        string(b.clientId).length > 200 ||
        string(b.clientSecret).length > 2000
      )
        throw new Error("Credenciais inválidas.");
      patch = {
        client_id: string(b.clientId),
        client_secret: encryptToken(string(b.clientSecret)),
        access_token: null,
        refresh_token: null,
        expires_at: null,
        refresh_expires_at: null,
        verified_at: null,
        verified_tax_id: null,
        version: current.data.version + 1,
        oauth_flow: null,
        oauth_expires_at: null,
        enabled: true,
      };
    }
    const saved = await db
      .from("analytics_connections")
      .update(patch)
      .eq("workspace_id", workspace)
      .eq("id", b.id)
      .eq("version", current.data.version)
      .select("id")
      .single();
    if (saved.error) throw new Error("Não foi possível atualizar a conexão.");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return analyticsError(e);
  }
}
