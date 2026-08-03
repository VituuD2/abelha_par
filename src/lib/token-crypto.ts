import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const VERSION = "v1";

function getEncryptionKey(): Buffer {
  const value = process.env.TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error("TOKEN_ENCRYPTION_KEY não configurada.");

  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY deve ser uma chave base64 de 32 bytes.");
  }
  return key;
}

export function encryptToken(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptToken(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== VERSION || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Token armazenado em formato inválido ou legado.");
  }
  const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivValue, "base64"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64")), decipher.final()]).toString("utf8");
}
