import "server-only";

import { createHash, createHmac, timingSafeEqual } from "crypto";

const STATE_VERSION = "v1";
const STATE_TTL_MS = 10 * 60 * 1_000;

type StatePayload = {
  expiresAt: number;
  flowId: string;
  userId: string;
};

function getSigningKey() {
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("TOKEN_ENCRYPTION_KEY não configurada.");

  // Use a separate derived key so the OAuth state and stored tokens never use
  // the same cryptographic purpose directly.
  return createHash("sha256")
    .update("abelha-par:tiny-oauth-state:v1")
    .update(encryptionKey)
    .digest();
}

function sign(value: string) {
  return createHmac("sha256", getSigningKey()).update(value).digest("base64url");
}

export function createTinyOAuthState(userId: string) {
  const payload: StatePayload = {
    userId,
    flowId: crypto.randomUUID(),
    expiresAt: Date.now() + STATE_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const value = `${STATE_VERSION}.${encodedPayload}`;
  return { state: `${value}.${sign(value)}`, flowId: payload.flowId };
}

export function verifyTinyOAuthState(state: string, userId: string): StatePayload | null {
  const [version, encodedPayload, signature, ...extraParts] = state.split(".");
  if (version !== STATE_VERSION || !encodedPayload || !signature || extraParts.length > 0) return null;

  const value = `${version}.${encodedPayload}`;
  const expectedSignature = sign(value);
  const received = Buffer.from(signature);
  const expected = Buffer.from(expectedSignature);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as StatePayload;
    if (
      !payload
      || typeof payload.userId !== "string"
      || typeof payload.flowId !== "string"
      || !Number.isFinite(payload.expiresAt)
      || payload.expiresAt < Date.now()
      || payload.userId !== userId
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
