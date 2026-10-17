import { z } from "zod";

/**
 * Remote image hosts that next/image is configured for (apps/web/next.config.ts `images.remotePatterns`).
 * Seller-supplied image URLs are restricted to these so the storefront (next/image) can never crash on an unknown host.
 * If you add a host to next.config.ts, add it here as well.
 */
export const ALLOWED_IMAGE_HOSTS = ["picsum.photos", "fastly.picsum.photos", "placehold.co", "images.unsplash.com", "cdn.cloudflare.steamstatic.com", "shared.fastly.steamstatic.com"] as const;

export function isAllowedImageUrl(raw: string): boolean {
  // Own generated artwork (seeded catalog) is always fine.
  if (/^\/api\/art\/[a-z0-9-]+\/(cover|avatar|[123])$/i.test(raw)) return true;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (ALLOWED_IMAGE_HOSTS as readonly string[]).includes(u.hostname);
  } catch {
    return false;
  }
}

/** zod schema for one seller-supplied image URL. */
export const imageUrlSchema = z
  .string()
  .trim()
  .max(500, "Слишком длинная ссылка")
  .refine(isAllowedImageUrl, `Разрешены https-ссылки с доменов: ${ALLOWED_IMAGE_HOSTS.join(", ")}`);
