import "server-only";

import { createHmac, timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import type { OlistWebhookStatus } from "@/types";

export async function getOlistWebhookStatus(workspaceId: string): Promise<OlistWebhookStatus> {
  try {
    const { data, error } = await createAdminClient().from("olist_sync_state")
      .select("last_webhook_at").eq("workspace_id", workspaceId)
      .abortSignal(AbortSignal.timeout(3_000)).maybeSingle();
    if (error) return { status: "unknown", lastReceivedAt: null };
    if (!data?.last_webhook_at) return { status: "pending", lastReceivedAt: null };
    const timestamp = Date.parse(data.last_webhook_at);
    if (!Number.isFinite(timestamp)) return { status: "unknown", lastReceivedAt: null };
    return { status: "active", lastReceivedAt: new Date(timestamp).toISOString() };
  } catch {
    // A webhook status read must not make a working OAuth connection look disconnected.
    return { status: "unknown", lastReceivedAt: null };
  }
}

function signingSecret() {
  const secret = process.env.OLIST_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("OLIST_WEBHOOK_SECRET deve ter ao menos 32 caracteres.");
  }
  return secret;
}

export function getOlistWebhookSignature(workspaceId: string, revision = 0) {
  return createHmac("sha256", signingSecret())
    .update(`olist-webhook:${workspaceId}${revision ? `:${revision}` : ""}`)
    .digest("base64url");
}

export function isValidOlistWebhookSignature(workspaceId: string, signature: string, revision = 0) {
  try {
    const expected = Buffer.from(getOlistWebhookSignature(workspaceId, revision));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export function getOlistWebhookUrl(appUrl: string, workspaceId: string, revision = 0) {
  try {
    return `${appUrl}/api/webhooks/olist/${workspaceId}/${getOlistWebhookSignature(workspaceId, revision)}`;
  } catch {
    return null;
  }
}

export function extractOlistOrderId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  const candidates = [
    (value.dados as Record<string, unknown> | undefined)?.id,
    value.idPedido,
    value.id,
    (value.pedido as Record<string, unknown> | undefined)?.id,
    (value.data as Record<string, unknown> | undefined)?.id,
  ];
  for (const candidate of candidates) {
    const numeric = typeof candidate === "number" ? candidate : Number(candidate);
    if (Number.isSafeInteger(numeric) && numeric > 0) return numeric;
  }
  return null;
}
