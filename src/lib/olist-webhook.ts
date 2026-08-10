import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

function signingSecret() {
  const secret = process.env.OLIST_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("OLIST_WEBHOOK_SECRET deve ter ao menos 32 caracteres.");
  }
  return secret;
}

export function getOlistWebhookSignature(ownerId: string) {
  return createHmac("sha256", signingSecret())
    .update(`olist-webhook:${ownerId}`)
    .digest("base64url");
}

export function isValidOlistWebhookSignature(ownerId: string, signature: string) {
  try {
    const expected = Buffer.from(getOlistWebhookSignature(ownerId));
    const received = Buffer.from(signature);
    return expected.length === received.length && timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

export function getOlistWebhookUrl(appUrl: string, ownerId: string) {
  try {
    return `${appUrl}/api/webhooks/olist/${ownerId}/${getOlistWebhookSignature(ownerId)}`;
  } catch {
    return null;
  }
}

export function extractOlistOrderId(payload: unknown): number | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  const candidates = [
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
