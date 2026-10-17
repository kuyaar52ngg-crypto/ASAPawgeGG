import { z } from "zod";
import { PRODUCT_TYPES, SORT_OPTIONS } from "@asap/shared/constants";
import { catalogQuerySchema } from "@asap/shared/schemas";

/** Sort values accepted by the storefront. "relevance" is only meaningful for /search. */
export const CATALOG_SORTS = [...SORT_OPTIONS.map((s) => s.value), "relevance"] as const;
export type CatalogSort = (typeof CATALOG_SORTS)[number];

const flag = z.preprocess((v) => v === "1" || v === "true" || v === "on" || v === true, z.boolean());

/**
 * Query accepted by /catalog, /catalog/[category] and /search.
 * Extends the shared `catalogQuerySchema` (docs/CONTRACTS.md §17) with `discount` and a safe boolean `inStock`
 * (z.coerce.boolean would turn the string "false" into true).
 */
export const catalogPageQuerySchema = catalogQuerySchema.extend({
  type: z.enum(PRODUCT_TYPES).optional(),
  // URL values are strings: the shared kopecksSchema is not coercing
  minPrice: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  maxPrice: z.coerce.number().int().min(0).max(2_000_000_000).optional(),
  inStock: flag.optional(),
  discount: flag.optional(),
  sort: z.enum(CATALOG_SORTS).default("popular"),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});
export type CatalogPageQuery = z.infer<typeof catalogPageQuerySchema>;

export type RawSearchParams = Record<string, string | string[] | undefined>;

/** Lenient parse of Next.js searchParams: bad / empty values are dropped instead of failing the request. */
export function parseCatalogParams(raw: RawSearchParams, defaults: Partial<CatalogPageQuery> = {}): CatalogPageQuery {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const val = Array.isArray(v) ? v[0] : v;
    if (typeof val === "string" && val.trim() !== "") flat[k] = val.trim();
  }
  const attempt = catalogPageQuerySchema.safeParse({ ...defaults, ...flat });
  if (attempt.success) return attempt.data;
  // Drop every key that failed validation and retry.
  const bad = new Set(attempt.error.issues.map((i) => String(i.path[0])));
  for (const k of bad) delete flat[k];
  const retry = catalogPageQuerySchema.safeParse({ ...defaults, ...flat });
  return retry.success ? retry.data : catalogPageQuerySchema.parse({ ...defaults });
}

/** Build a querystring from a query, omitting defaults. `overrides` with `undefined`/"" removes a key. */
export function buildCatalogQs(q: Partial<CatalogPageQuery>, overrides: Record<string, string | number | boolean | undefined | null> = {}, opts: { omit?: string[]; defaultSort?: CatalogSort } = {}): string {
  const p = new URLSearchParams();
  const set = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "" || v === false) return;
    p.set(k, v === true ? "1" : String(v));
  };
  const omit = new Set(opts.omit ?? []);
  const merged: Record<string, unknown> = { ...q, ...overrides };
  for (const k of ["q", "platform", "region", "type", "minPrice", "maxPrice", "inStock", "discount", "sort", "page"]) {
    if (omit.has(k)) continue;
    const v = merged[k];
    if (k === "sort" && v === (opts.defaultSort ?? "popular")) continue;
    if (k === "page" && (v === 1 || v === "1")) continue;
    set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}
