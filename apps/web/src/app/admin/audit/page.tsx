import { prisma, type Prisma } from "@asap/db";
import { requireRole } from "@/server/auth/session";
import { ADMIN_PAGE_SIZE, pageParam, strParam } from "@/server/admin/action";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Pager, SearchForm, href } from "@/components/admin/common";
import { fmtDateTime } from "@/components/admin/labels";
import { ScrollText } from "lucide-react";

export const metadata = { title: "Админка · Аудит-лог" };
export const dynamic = "force-dynamic";

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const entity = strParam(sp.entity);
  const page = pageParam(sp.page);

  const where: Prisma.AuditLogWhereInput = {
    ...(entity ? { entityType: entity } : {}),
    ...(q ? { OR: [{ action: { contains: q, mode: "insensitive" } }, { entityId: q }, { actor: { email: { contains: q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows, entities] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * ADMIN_PAGE_SIZE, take: ADMIN_PAGE_SIZE, include: { actor: { select: { email: true } } } }),
    prisma.auditLog.groupBy({ by: ["entityType"], _count: { _all: true }, orderBy: { entityType: "asc" } }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));

  return (
    <>
      <PageHeader title="Аудит-лог" description={`Записей: ${total}. Каждое действие администратора пишется сюда в той же транзакции.`} />
      <SearchForm action="/admin/audit" q={q} placeholder="Действие, ID сущности или email" hidden={{ entity }}>
        <select name="entity" defaultValue={entity} aria-label="Сущность" className="h-11 rounded-xl border border-input bg-card px-3 text-sm">
          <option value="">Все сущности</option>
          {entities.map((e) => <option key={e.entityType} value={e.entityType}>{e.entityType} ({e._count._all})</option>)}
        </select>
      </SearchForm>

      {rows.length === 0 ? (
        <EmptyState icon={<ScrollText />} title="Записей нет" description="Измените фильтры." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Время</TableHead><TableHead>Кто</TableHead><TableHead>Действие</TableHead><TableHead>Сущность</TableHead><TableHead>Изменения</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(r.createdAt)}{r.ip && <><br />{r.ip}</>}</TableCell>
                <TableCell className="text-sm">{r.actor?.email ?? "система"}</TableCell>
                <TableCell><Badge variant="secondary">{r.action}</Badge></TableCell>
                <TableCell className="text-xs"><span className="font-medium">{r.entityType}</span>{r.entityId && <><br /><span className="text-muted-foreground">{r.entityId}</span></>}</TableCell>
                <TableCell className="max-w-md">
                  {r.before == null && r.after == null ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <details className="text-xs">
                      <summary className="cursor-pointer text-primary">показать</summary>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {r.before != null && <pre className="max-h-48 overflow-auto rounded-lg bg-foreground/5 p-2 whitespace-pre-wrap break-all"><b>до</b>{"\n"}{pretty(r.before)}</pre>}
                        {r.after != null && <pre className="max-h-48 overflow-auto rounded-lg bg-foreground/5 p-2 whitespace-pre-wrap break-all"><b>после</b>{"\n"}{pretty(r.after)}</pre>}
                      </div>
                    </details>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(p) => href("/admin/audit", { q, entity, page: p })} />
    </>
  );
}
