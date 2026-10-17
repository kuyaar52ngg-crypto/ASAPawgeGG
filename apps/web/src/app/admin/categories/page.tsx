import { prisma } from "@asap/db";
import { requireRole } from "@/server/auth/session";
import { CATEGORY_ICONS } from "@/server/admin/categories";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CategoryFormDialog, DeleteCategoryButton } from "@/components/admin/category-actions";

export const metadata = { title: "Админка · Категории" };
export const dynamic = "force-dynamic";

export default async function AdminCategoriesPage() {
  await requireRole("ADMIN");
  const rows = await prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { products: true, children: true } } } });
  const roots = rows.filter((r) => !r.parentId);
  const ordered = roots.flatMap((r) => [r, ...rows.filter((c) => c.parentId === r.id)]);
  const rootOptions = roots.map((r) => ({ id: r.id, name: r.name }));

  return (
    <>
      <PageHeader title="Категории" description="Дерево каталога (два уровня). Изменения сразу видны в меню и фильтрах витрины" actions={<CategoryFormDialog roots={rootOptions} icons={CATEGORY_ICONS} />} />
      <Table>
        <TableHeader>
          <TableRow><TableHead>Категория</TableHead><TableHead>Slug</TableHead><TableHead className="text-right">Товаров</TableHead><TableHead className="text-right">Порядок</TableHead><TableHead>Статус</TableHead><TableHead className="text-right">Действия</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {ordered.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <div className={`flex items-center gap-2 ${c.parentId ? "pl-8" : "font-semibold"}`}>
                  <CategoryIcon name={c.icon} className="size-4 text-primary" />
                  {c.name}
                </div>
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{c.slug}</TableCell>
              <TableCell className="text-right tabular-nums">{c._count.products}</TableCell>
              <TableCell className="text-right tabular-nums">{c.sortOrder}</TableCell>
              <TableCell>{c.isActive ? <Badge variant="success">Активна</Badge> : <Badge variant="secondary">Скрыта</Badge>}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1.5">
                  <CategoryFormDialog category={{ id: c.id, name: c.name, slug: c.slug, parentId: c.parentId ?? "", icon: c.icon ?? "", description: c.description ?? "", sortOrder: c.sortOrder, isActive: c.isActive }} roots={rootOptions} icons={CATEGORY_ICONS} hasChildren={c._count.children > 0} />
                  {c._count.products === 0 && c._count.children === 0 && <DeleteCategoryButton id={c.id} name={c.name} />}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
