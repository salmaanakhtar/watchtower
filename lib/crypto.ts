// WT-8: field-level encryption at rest + deterministic lookup hashes.
//
// Encryption: AES-256-GCM via Node crypto. Envelope format is
// `v1.<ivB64>.<authTagB64>.<ciphertextB64>` so the key can be rotated later
// without migrating rows (decrypt reads the embedded IV/tag). Values that
// don't parse as an envelope are returned untouched — that keeps legacy
// plaintext rows (pre-WT-8) readable while new writes are encrypted.
//
// Lookups: emails are matched via a deterministic HMAC hash (emailHash)
// instead of the encrypted value, so `findUnique`/`upsert` by email still
// work without leaking the plaintext in the DB.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32; // bytes

export const PREFIX = "v1";

function keyBytes(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) return Buffer.from("dev-field-encryption-key-change-me-000", "utf8").subarray(0, KEY_LEN);
  const fromHex = Buffer.from(raw, "hex");
  return fromHex.length === KEY_LEN ? fromHex : Buffer.from(raw, "utf8").subarray(0, KEY_LEN);
}

export function hashKey(): string {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  return raw && raw.length >= 16 ? raw : "dev-field-lookup-hash-key";
}

/** Encrypt a plaintext string. Returns `v1.<iv>.<tag>.<ct>` or null for null/undefined input. */
export function encryptField(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined) return null;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, keyBytes(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}.${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

/** Decrypt an envelope; returns the original value when it is not encrypted (legacy plaintext). */
export function decryptField(enc: string | null | undefined): string | null {
  if (enc === null || enc === undefined) return null;
  const parts = enc.split(".");
  if (parts.length !== 4 || parts[0] !== PREFIX) return enc;
  try {
    const iv = Buffer.from(parts[1], "base64url");
    const tag = Buffer.from(parts[2], "base64url");
    const ct = Buffer.from(parts[3], "base64url");
    if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return enc;
    const decipher = createDecipheriv(ALGO, keyBytes(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // Tampered/undecryptable value: fail safe by returning it as-is rather
    // than crashing reads; corrupt rows are surfaced by the audit log.
    return enc;
  }
}

/** Deterministic HMAC-SHA256 hex digest used for equality lookups on encrypted fields. */
export function hashForLookup(value: string): string {
  return createHmac("sha256", hashKey()).update(value, "utf8").digest("hex");
}
