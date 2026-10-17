import "server-only";
import { prisma } from "@asap/db";
import { cached } from "@/lib/redis";

export interface CategoryNode {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  description: string | null;
  children: CategoryNode[];
}

/** Active category tree (2 levels), cached 60s in Redis. */
export async function getCategoryTree(): Promise<CategoryNode[]> {
  return cached("categories:tree", 60, async () => {
    const rows = await prisma.category.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
    const byParent = new Map<string | null, typeof rows>();
    for (const r of rows) {
      const list = byParent.get(r.parentId) ?? [];
      list.push(r);
      byParent.set(r.parentId, list);
    }
    const build = (parentId: string | null): CategoryNode[] =>
      (byParent.get(parentId) ?? []).map((c) => ({ id: c.id, name: c.name, slug: c.slug, icon: c.icon, description: c.description, children: build(c.id) }));
    return build(null);
  });
}
