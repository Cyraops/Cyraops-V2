import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * AES-256-GCM helper for provider API keys at rest.
 *
 * The key comes from AI_KEY_ENCRYPTION_SECRET (any long random string; it is
 * hashed to 32 bytes). When it is absent the feature is disabled rather than
 * falling back to plaintext storage.
 */
function getKey(): Buffer | null {
  const secret = process.env.AI_KEY_ENCRYPTION_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  return createHash("sha256").update(secret).digest();
}

export function isEncryptionAvailable(): boolean {
  return getKey() !== null;
}

export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key) throw new Error("AI_KEY_ENCRYPTION_SECRET is not configured");

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const key = getKey();
  if (!key) throw new Error("AI_KEY_ENCRYPTION_SECRET is not configured");

  const [version, ivB64, tagB64, dataB64] = payload.split(":");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Unsupported secret payload");
  }

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}

/** Only ever show the last four characters of a key. */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  return `••••${plaintext.slice(-4)}`;
}
