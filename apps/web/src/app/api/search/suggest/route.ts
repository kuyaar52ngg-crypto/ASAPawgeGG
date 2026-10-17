import { z } from "zod";
import { jsonError, jsonOk, limitByIp } from "@/lib/api";
import { suggest } from "@/server/catalog/search";

export const dynamic = "force-dynamic";

const querySchema = z.object({ q: z.string().trim().min(1).max(80) });

/** GET /api/search/suggest?q= — header live-suggest (products + categories), Redis-cached 60s. */
export async function GET(req: Request) {
  const limited = await limitByIp(req, "search-suggest", 90, 60);
  if (limited) return limited;
  const parsed = querySchema.safeParse({ q: new URL(req.url).searchParams.get("q") ?? "" });
  if (!parsed.success) return jsonOk({ q: "", products: [], categories: [], total: 0 });
  try {
    const res = jsonOk(await suggest(parsed.data.q));
    res.headers.set("Cache-Control", "private, max-age=30");
    return res;
  } catch (err) {
    console.error("[search/suggest]", (err as Error).message);
    return jsonError(500, "search_failed", "Не удалось выполнить поиск");
  }
}
