import "server-only";
import { prisma } from "@asap/db";

/** Selectable (leaf) categories as «Родитель › Название» for the product form. */
export async function getCategoryOptions(): Promise<{ id: string; label: string }[]> {
  const rows = await prisma.category.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, parentId: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parents = new Set(rows.map((r) => r.parentId).filter(Boolean));
  return rows
    .filter((r) => !parents.has(r.id))
    .map((r) => ({ id: r.id, label: r.parentId && byId.get(r.parentId) ? `${byId.get(r.parentId)!.name} › ${r.name}` : r.name }))
    .sort((a, b) => a.label.localeCompare(b.label, "ru"));
}
