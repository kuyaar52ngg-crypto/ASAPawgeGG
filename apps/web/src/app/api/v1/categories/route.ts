import { jsonOk } from "@/lib/api";
import { apiRoute } from "@/server/api-keys";
import { getCategoryTree, type CategoryNode } from "@/server/categories";

export const dynamic = "force-dynamic";

const dto = (n: CategoryNode): { id: string; name: string; slug: string; description: string | null; children: unknown[] } => ({ id: n.id, name: n.name, slug: n.slug, description: n.description, children: n.children.map(dto) });

/** GET /api/v1/categories — active category tree. */
export const GET = apiRoute({ scope: "catalog:read" }, async () => jsonOk((await getCategoryTree()).map(dto)));
