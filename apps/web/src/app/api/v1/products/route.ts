import { jsonOk } from "@/lib/api";
import { apiRoute } from "@/server/api-keys";
import { baseUrl } from "@/server/api-v1/http";
import { productCardDto } from "@/server/api-v1/dto";
import { listProducts, resolveCategory } from "@/server/catalog/queries";
import { parseCatalogParams } from "@/server/catalog/query";
import { searchProductIds } from "@/server/catalog/search";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/products?q=&category=<slug>&platform=&region=&type=&minPrice=&maxPrice=&inStock=1&sort=&page=&pageSize=
 * Prices in kopecks. `q` = typo-tolerant full-text search (sort defaults to relevance).
 */
export const GET = apiRoute({ scope: "catalog:read" }, async ({ req }) => {
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const q = parseCatalogParams(sp, sp.q ? { sort: "relevance" } : {});
  const empty = { items: [], total: 0, page: q.page, pageSize: q.pageSize, pageCount: 1 };
  let categoryIds: string[] | undefined;
  if (q.category) {
    const cat = await resolveCategory(q.category);
    if (!cat) return jsonOk(empty);
    categoryIds = cat.ids;
  }
  let ids: string[] | undefined;
  if (q.q) {
    ids = await searchProductIds(q.q, 300);
    if (ids.length === 0) return jsonOk(empty);
  }
  const res = await listProducts(q, { categoryIds, ids });
  const b = baseUrl();
  return jsonOk({ items: res.items.map((p) => productCardDto(p, b)), total: res.total, page: res.page, pageSize: res.pageSize, pageCount: res.pageCount });
});
