/**
 * Stock-item encryption (AES-256-GCM). Node.js only (server code).
 *
 * WIRE FORMAT (must stay in sync with apps/worker/app/crypto.py):
 *
 *   payloadEnc = base64( iv[12 bytes] || authTag[16 bytes] || ciphertext[n bytes] )
 *
 *   - key:   STOCK_ENCRYPTION_KEY env, 32 bytes, given as base64 OR 64 hex chars
 *   - iv:    12 random bytes per encryption
 *   - tag:   16-byte GCM tag (note: placed BEFORE the ciphertext)
 *   - AAD:   none
 *   - plaintext: UTF-8 string (the key / login:password / JSON blob)
 *
 * Python equivalent:
 *   raw = base64.b64decode(s); iv, tag, ct = raw[:12], raw[12:28], raw[28:]
 *   AESGCM(key).decrypt(iv, ct + tag, None)      # cryptography wants ct||tag
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const IV_LEN = 12;
const TAG_LEN = 16;

export function parseStockKey(raw: string | undefined = process.env.STOCK_ENCRYPTION_KEY): Buffer {
  if (!raw) throw new Error("STOCK_ENCRYPTION_KEY is not set");
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64");
  if (key.length !== 32) throw new Error(`STOCK_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`);
  return key;
}

export function encryptStock(plaintext: string, key: Buffer = parseStockKey()): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

export function decryptStock(payloadEnc: string, key: Buffer = parseStockKey()): string {
  const raw = Buffer.from(payloadEnc, "base64");
  if (raw.length < IV_LEN + TAG_LEN) throw new Error("Invalid stock payload");
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = raw.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/** sha256 hex of the plaintext — used as StockItem.fingerprint for dedupe. */
export function stockFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext.trim(), "utf8").digest("hex");
}

// ───────────── API keys ─────────────
export const API_KEY_PREFIX = "ak_live_";

/** Generates a new API key. Store ONLY `hash` + `prefix`; show `key` to the user once. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const secret = randomBytes(24).toString("hex"); // 48 hex chars
  const key = `${API_KEY_PREFIX}${secret}`;
  return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 8), hash: hashApiKey(key) };
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function isApiKeyFormat(key: string): boolean {
  return /^ak_live_[0-9a-f]{48}$/.test(key);
}
