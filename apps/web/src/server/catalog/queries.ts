import "server-only";
import { prisma, type Prisma } from "@asap/db";
import { PLATFORMS, PRODUCT_TYPES, PRODUCT_TYPE_LABELS, REGIONS, type DeliveryModeName, type ProductTypeName } from "@asap/shared";
import { cached } from "@/lib/redis";
import { getCategoryTree, type CategoryNode } from "@/server/categories";
import type { CatalogFacets, CatalogResult, FacetOption, ProductCardData } from "./types";
import type { CatalogPageQuery } from "./query";

// ───────────────────────── card mapping ─────────────────────────

export const cardSelect = {
  id: true,
  slug: true,
  title: true,
  coverImage: true,
  price: true,
  oldPrice: true,
  platform: true,
  region: true,
  type: true,
  deliveryMode: true,
  ratingAvg: true,
  ratingCount: true,
  salesCount: true,
  seller: { select: { name: true, sellerProfile: { select: { shopName: true, slug: true } } } },
  _count: { select: { variants: { where: { isActive: true } } } },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

/** AVAILABLE stock per product (only AUTO_STOCK products consume stock). */
async function availableStock(productIds: string[]): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();
  const rows = await prisma.stockItem.groupBy({ by: ["productId"], where: { productId: { in: productIds }, status: "AVAILABLE" }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.productId, r._count._all]));
}

export async function favoriteIds(userId: string | null | undefined, productIds: string[]): Promise<Set<string>> {
  if (!userId || productIds.length === 0) return new Set();
  const rows = await prisma.favorite.findMany({ where: { userId, productId: { in: productIds } }, select: { productId: true } });
  return new Set(rows.map((r) => r.productId));
}

/** Map DB rows to serialisable card payloads (adds stock + favourite flags with 2 batched queries). */
export async function toCards(rows: CardRow[], userId?: string | null): Promise<ProductCardData[]> {
  const ids = rows.map((r) => r.id);
  const [stock, favs] = await Promise.all([availableStock(ids), favoriteIds(userId, ids)]);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    coverImage: r.coverImage,
    price: r.price,
    oldPrice: r.oldPrice && r.oldPrice > r.price ? r.oldPrice : null,
    platform: r.platform,
    region: r.region,
    type: r.type as ProductTypeName,
    deliveryMode: r.deliveryMode as DeliveryModeName,
    ratingAvg: r.ratingAvg,
    ratingCount: r.ratingCount,
    salesCount: r.salesCount,
    hasVariants: r._count.variants > 0,
    inStock: r.deliveryMode !== "AUTO_STOCK" || (stock.get(r.id) ?? 0) > 0,
    sellerName: r.seller.sellerProfile?.shopName ?? r.seller.name,
    sellerSlug: r.seller.sellerProfile?.slug ?? null,
    isFavorite: favs.has(r.id),
  }));
}

async function cardsByIds(ids: string[], userId?: string | null): Promise<ProductCardData[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.product.findMany({ where: { id: { in: ids }, status: "ACTIVE" }, select: cardSelect });
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return toCards(rows, userId);
}

// ───────────────────────── categories ─────────────────────────

export interface ResolvedCategory {
  node: CategoryNode;
  parent: CategoryNode | null;
  /** node id + all descendants */
  ids: string[];
}

function collectIds(n: CategoryNode): string[] {
  return [n.id, ...n.children.flatMap(collectIds)];
}

export async function resolveCategory(slug: string): Promise<ResolvedCategory | null> {
  const tree = await getCategoryTree();
  const walk = (nodes: CategoryNode[], parent: CategoryNode | null): ResolvedCategory | null => {
    for (const n of nodes) {
      if (n.slug === slug) return { node: n, parent, ids: collectIds(n) };
      const hit = walk(n.children, n);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree, null);
}

export interface CategoryTile {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  count: number;
  children: { name: string; slug: string }[];
}

/** Root categories with the number of ACTIVE products (incl. descendants). */
export async function getCategoryTiles(): Promise<CategoryTile[]> {
  const [tree, counts] = await Promise.all([
    getCategoryTree(),
    cached("catalog:category-counts", 60, async () => {
      const rows = await prisma.product.groupBy({ by: ["categoryId"], where: { status: "ACTIVE" }, _count: { _all: true } });
      return rows.map((r) => [r.categoryId, r._count._all] as const);
    }),
  ]);
  const map = new Map(counts);
  return tree.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    icon: c.icon,
    description: c.description,
    count: collectIds(c).reduce((s, id) => s + (map.get(id) ?? 0), 0),
    children: c.children.map((ch) => ({ name: ch.name, slug: ch.slug })),
  }));
}

// ───────────────────────── listing ─────────────────────────

/** ids of products whose old price is above the current price (cannot be expressed with Prisma filters). */
async function discountedIds(): Promise<string[]> {
  return cached("catalog:discounted-ids", 30, async () => {
    const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE status = 'ACTIVE' AND "oldPrice" IS NOT NULL AND "oldPrice" > price`;
    return rows.map((r) => r.id);
  });
}

async function buildWhere(q: CatalogPageQuery, extra: { categoryIds?: string[]; ids?: string[] } = {}): Promise<Prisma.ProductWhereInput> {
  const and: Prisma.ProductWhereInput[] = [{ status: "ACTIVE" }];
  if (extra.categoryIds) and.push({ categoryId: { in: extra.categoryIds } });
  if (extra.ids) and.push({ id: { in: extra.ids } });
  if (q.platform) and.push({ platform: q.platform });
  if (q.region) and.push({ region: q.region });
  if (q.type) and.push({ type: q.type });
  if (q.sellerId) and.push({ sellerId: q.sellerId });
  if (q.minPrice !== undefined) and.push({ price: { gte: q.minPrice } });
  if (q.maxPrice !== undefined) and.push({ price: { lte: q.maxPrice } });
  if (q.inStock) and.push({ OR: [{ deliveryMode: { not: "AUTO_STOCK" } }, { stockItems: { some: { status: "AVAILABLE" } } }] });
  if (q.discount) and.push({ id: { in: await discountedIds() } });
  return { AND: and };
}

function dbOrder(sort: CatalogPageQuery["sort"]): Prisma.ProductOrderByWithRelationInput[] | null {
  switch (sort) {
    case "popular":
      return [{ salesCount: "desc" }, { ratingAvg: "desc" }, { id: "asc" }];
    case "new":
      return [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }, { id: "asc" }];
    case "price_asc":
      return [{ price: "asc" }, { id: "asc" }];
    case "price_desc":
      return [{ price: "desc" }, { id: "asc" }];
    case "rating":
      return [{ ratingAvg: "desc" }, { ratingCount: "desc" }, { id: "asc" }];
    default:
      return null; // discount / relevance are sorted in JS
  }
}

/**
 * Filtered, sorted, paginated catalog listing (server-side; driven entirely by URL search params).
 * `ids` restricts to a precomputed set (search results) and is also the order for sort="relevance".
 */
export async function listProducts(q: CatalogPageQuery, opts: { categoryIds?: string[]; ids?: string[]; userId?: string | null } = {}): Promise<CatalogResult> {
  const where = await buildWhere(q, opts);
  const skip = (q.page - 1) * q.pageSize;
  const order = dbOrder(q.sort);

  let total: number;
  let items: ProductCardData[];

  if (order) {
    const [count, rows] = await Promise.all([prisma.product.count({ where }), prisma.product.findMany({ where, orderBy: order, skip, take: q.pageSize, select: cardSelect })]);
    total = count;
    items = await toCards(rows, opts.userId);
  } else {
    const rows = await prisma.product.findMany({ where, select: { id: true, price: true, oldPrice: true, salesCount: true }, take: 2000 });
    total = rows.length;
    if (q.sort === "discount") {
      const pct = (r: (typeof rows)[number]) => (r.oldPrice && r.oldPrice > r.price ? (r.oldPrice - r.price) / r.oldPrice : 0);
      rows.sort((a, b) => pct(b) - pct(a) || b.salesCount - a.salesCount);
    } else if (opts.ids) {
      const pos = new Map(opts.ids.map((id, i) => [id, i]));
      rows.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
    }
    items = await cardsByIds(rows.slice(skip, skip + q.pageSize).map((r) => r.id), opts.userId);
  }
  return { items, total, page: q.page, pageSize: q.pageSize, pageCount: Math.max(1, Math.ceil(total / q.pageSize)) };
}

const label = (list: readonly { value: string; label: string }[], v: string) => list.find((x) => x.value === v)?.label ?? v;

/** Filter options for the sidebar, scoped to the current category. */
export async function getFacets(categoryIds?: string[], sellerId?: string): Promise<CatalogFacets> {
  const key = `catalog:facets:${categoryIds ? [...categoryIds].sort().join(",") : "all"}:${sellerId ?? ""}`;
  return cached(key, 60, async () => {
    const where: Prisma.ProductWhereInput = { status: "ACTIVE", ...(categoryIds ? { categoryId: { in: categoryIds } } : {}), ...(sellerId ? { sellerId } : {}) };
    const [plat, reg, types, agg] = await Promise.all([
      prisma.product.groupBy({ by: ["platform"], where: { ...where, platform: { not: null } }, _count: { _all: true } }),
      prisma.product.groupBy({ by: ["region"], where: { ...where, region: { not: null } }, _count: { _all: true } }),
      prisma.product.groupBy({ by: ["type"], where, _count: { _all: true } }),
      prisma.product.aggregate({ where, _min: { price: true }, _max: { price: true } }),
    ]);
    const mk = (rows: { v: string | null; n: number }[], dict: readonly { value: string; label: string }[]): FacetOption[] =>
      rows
        .filter((r): r is { v: string; n: number } => !!r.v)
        .map((r) => ({ value: r.v, label: label(dict, r.v), count: r.n }))
        .sort((a, b) => b.count - a.count);
    return {
      platforms: mk(plat.map((r) => ({ v: r.platform, n: r._count._all })), PLATFORMS),
      regions: mk(reg.map((r) => ({ v: r.region, n: r._count._all })), REGIONS),
      types: types
        .map((r) => ({ value: r.type, label: PRODUCT_TYPE_LABELS[r.type as ProductTypeName] ?? r.type, count: r._count._all }))
        .filter((o) => (PRODUCT_TYPES as readonly string[]).includes(o.value))
        .sort((a, b) => b.count - a.count),
      priceMin: agg._min.price ?? 0,
      priceMax: agg._max.price ?? 0,
    };
  });
}

// ───────────────────────── home ─────────────────────────

export interface HeroSlide {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  image: string | null;
  price: number;
  oldPrice: number | null;
  platform: string | null;
  hasVariants: boolean;
  categoryName: string;
}

export interface HomeStats {
  deliveredOrders: number;
  activeProducts: number;
  verifiedSellers: number;
  avgRating: number;
  reviewsCount: number;
  medianDeliverySeconds: number | null;
}

export interface HomeReview {
  id: string;
  rating: number;
  text: string;
  buyerName: string;
  createdAt: string;
  productTitle: string;
  productSlug: string;
}

export function maskName(name?: string | null): string {
  if (!name) return "Покупатель";
  const [first, second] = name.trim().split(/\s+/);
  return second ? `${first} ${second[0]!.toUpperCase()}.` : first!;
}

export async function getHeroSlides(): Promise<HeroSlide[]> {
  const rows = await prisma.product.findMany({
    where: { status: "ACTIVE", isFeatured: true, coverImage: { not: null } },
    orderBy: [{ salesCount: "desc" }],
    take: 6,
    select: { id: true, slug: true, title: true, shortDescription: true, description: true, coverImage: true, price: true, oldPrice: true, platform: true, category: { select: { name: true } }, _count: { select: { variants: { where: { isActive: true } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    blurb: r.shortDescription ?? (r.description.length > 140 ? `${r.description.slice(0, 137).trimEnd()}…` : r.description),
    image: r.coverImage,
    price: r.price,
    oldPrice: r.oldPrice && r.oldPrice > r.price ? r.oldPrice : null,
    platform: r.platform,
    hasVariants: r._count.variants > 0,
    categoryName: r.category.name,
  }));
}

export async function getProductShelf(kind: "bestsellers" | "discounts" | "new" | "subscriptions", userId?: string | null, take = 12): Promise<ProductCardData[]> {
  const active = { status: "ACTIVE" } as const;
  if (kind === "discounts") {
    const ids = await discountedIds();
    const rows = await prisma.product.findMany({ where: { ...active, id: { in: ids } }, select: { ...cardSelect } });
    const pct = (r: (typeof rows)[number]) => (r.oldPrice ? (r.oldPrice - r.price) / r.oldPrice : 0);
    rows.sort((a, b) => pct(b) - pct(a) || b.salesCount - a.salesCount);
    return toCards(rows.slice(0, take), userId);
  }
  const rows = await prisma.product.findMany({
    where: kind === "subscriptions" ? { ...active, type: "SUBSCRIPTION" } : active,
    orderBy: kind === "new" ? [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }] : [{ salesCount: "desc" }, { ratingAvg: "desc" }],
    take,
    select: cardSelect,
  });
  return toCards(rows, userId);
}

export async function getHomeStats(): Promise<HomeStats> {
  return cached("catalog:home-stats", 300, async () => {
    const [delivered, products, sellers, rev, median] = await Promise.all([
      prisma.order.count({ where: { status: { in: ["DELIVERED", "DISPUTED"] } } }),
      prisma.product.count({ where: { status: "ACTIVE" } }),
      prisma.sellerProfile.count({ where: { status: "VERIFIED" } }),
      prisma.review.aggregate({ where: { status: "PUBLISHED" }, _avg: { rating: true }, _count: { _all: true } }),
      prisma.$queryRaw<{ m: number | null }[]>`SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM ("deliveredAt" - "paidAt")))::float AS m FROM "Order" WHERE "deliveredAt" IS NOT NULL AND "paidAt" IS NOT NULL`,
    ]);
    return {
      deliveredOrders: delivered,
      activeProducts: products,
      verifiedSellers: sellers,
      avgRating: Math.round((rev._avg.rating ?? 0) * 10) / 10,
      reviewsCount: rev._count._all,
      medianDeliverySeconds: median[0]?.m != null ? Math.round(median[0].m) : null,
    };
  });
}

export async function getLatestReviews(take = 8): Promise<HomeReview[]> {
  const rows = await prisma.review.findMany({
    where: { status: "PUBLISHED", rating: { gte: 4 }, text: { not: null } },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, rating: true, text: true, createdAt: true, buyer: { select: { name: true } }, product: { select: { title: true, slug: true } } },
  });
  return rows
    .filter((r) => r.text && r.text.trim().length > 0)
    .map((r) => ({ id: r.id, rating: r.rating, text: r.text!, buyerName: maskName(r.buyer.name), createdAt: r.createdAt.toISOString(), productTitle: r.product.title, productSlug: r.product.slug }));
}

// ───────────────────────── product page ─────────────────────────

export async function getProductBySlug(slug: string) {
  return prisma.product.findFirst({
    where: { slug, status: "ACTIVE" },
    include: {
      variants: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
      seller: { select: { id: true, name: true, createdAt: true, sellerProfile: true } },
      category: { select: { id: true, name: true, slug: true, parentId: true } },
    },
  });
}

/** AVAILABLE stock counts: key = variantId, "" = product-level (no variant). */
export async function getStockByVariant(productId: string): Promise<Map<string, number>> {
  const rows = await prisma.stockItem.groupBy({ by: ["variantId"], where: { productId, status: "AVAILABLE" }, _count: { _all: true } });
  return new Map(rows.map((r) => [r.variantId ?? "", r._count._all]));
}

export async function getSimilarProducts(p: { id: string; categoryId: string; type: string; platform: string | null }, userId?: string | null, take = 8): Promise<ProductCardData[]> {
  const same = await prisma.product.findMany({ where: { status: "ACTIVE", id: { not: p.id }, categoryId: p.categoryId }, orderBy: [{ salesCount: "desc" }], take, select: cardSelect });
  let rows = same;
  if (rows.length < take) {
    const more = await prisma.product.findMany({
      where: { status: "ACTIVE", id: { notIn: [p.id, ...rows.map((r) => r.id)] }, OR: [{ type: p.type as ProductTypeName }, ...(p.platform ? [{ platform: p.platform }] : [])] },
      orderBy: [{ salesCount: "desc" }],
      take: take - rows.length,
      select: cardSelect,
    });
    rows = [...rows, ...more];
  }
  return toCards(rows, userId);
}

export interface ReviewView {
  id: string;
  rating: number;
  text: string | null;
  reply: string | null;
  createdAt: string;
  buyerName: string;
  variantTitle: string | null;
}

export async function getProductReviews(productId: string, page: number, pageSize = 6) {
  const where = { productId, status: "PUBLISHED" as const };
  const [total, rows, dist] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, rating: true, text: true, reply: true, createdAt: true, buyer: { select: { name: true } }, orderItem: { select: { variantTitle: true } } },
    }),
    prisma.review.groupBy({ by: ["rating"], where, _count: { _all: true } }),
  ]);
  const distribution = [5, 4, 3, 2, 1].map((stars) => ({ stars, count: dist.find((d) => d.rating === stars)?._count._all ?? 0 }));
  const items: ReviewView[] = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    text: r.text,
    reply: r.reply,
    createdAt: r.createdAt.toISOString(),
    buyerName: maskName(r.buyer.name),
    variantTitle: r.orderItem.variantTitle,
  }));
  return { items, total, pageCount: Math.max(1, Math.ceil(total / pageSize)), distribution };
}

export async function isFavorite(userId: string | null | undefined, productId: string): Promise<boolean> {
  if (!userId) return false;
  return (await prisma.favorite.count({ where: { userId, productId } })) > 0;
}

/** Best-effort view counter (never blocks / throws). */
export function bumpViewCount(productId: string): void {
  prisma.product.update({ where: { id: productId }, data: { viewCount: { increment: 1 } } }).catch(() => undefined);
}

// ───────────────────────── seller store ─────────────────────────

export async function getSellerBySlugOrUserId(key: string) {
  const profile = await prisma.sellerProfile.findFirst({
    where: { OR: [{ slug: key }, { userId: key }], status: { in: ["VERIFIED", "PENDING"] } },
    include: { user: { select: { id: true, name: true, createdAt: true } } },
  });
  return profile;
}

export async function getSellerReviews(sellerId: string, take = 6): Promise<(ReviewView & { productTitle: string; productSlug: string })[]> {
  const rows = await prisma.review.findMany({
    where: { sellerId, status: "PUBLISHED" },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, rating: true, text: true, reply: true, createdAt: true, buyer: { select: { name: true } }, orderItem: { select: { variantTitle: true } }, product: { select: { title: true, slug: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    text: r.text,
    reply: r.reply,
    createdAt: r.createdAt.toISOString(),
    buyerName: maskName(r.buyer.name),
    variantTitle: r.orderItem.variantTitle,
    productTitle: r.product.title,
    productSlug: r.product.slug,
  }));
}
