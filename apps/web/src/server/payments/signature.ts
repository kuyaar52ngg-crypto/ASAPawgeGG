import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 of the raw request body, lowercase hex. */
export function hmacSha256Hex(secret: string, rawBody: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/** Constant-time string comparison that is also safe for different lengths (compares SHA-256 digests). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

/**
 * Verify an HMAC-SHA256 signature of the raw body. Accepts hex (any case) or base64, with an optional
 * "sha256=" prefix (GitHub/Stripe style). Returns false on any mismatch; never throws.
 */
export function verifyHmacSignature(opts: { secret: string; rawBody: string; signature: string | null | undefined }): boolean {
  const { secret, rawBody } = opts;
  if (!secret || !opts.signature) return false;
  const sig = opts.signature.trim().replace(/^sha256=/i, "");
  if (!sig) return false;
  const expectedHex = hmacSha256Hex(secret, rawBody);
  if (safeEqual(sig.toLowerCase(), expectedHex)) return true;
  const expectedB64 = createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  return safeEqual(sig, expectedB64);
}

/** Header-based shared-secret check (Platega: X-MerchantId + X-Secret on the callback). */
export function verifyHeaderCredentials(headers: Headers, expected: { idHeader: string; id: string; secretHeader: string; secret: string }): boolean {
  if (!expected.id || !expected.secret) return false;
  const id = headers.get(expected.idHeader) ?? "";
  const secret = headers.get(expected.secretHeader) ?? "";
  // evaluate both comparisons (no short-circuit) to keep timing uniform
  const okId = safeEqual(id, expected.id);
  const okSecret = safeEqual(secret, expected.secret);
  return okId && okSecret;
}
