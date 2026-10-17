import Link from "next/link";
import { prisma, type Prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { ADMIN_PAGE_SIZE, pageParam, strParam } from "@/server/admin/action";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterPills, Pager, SearchForm, href } from "@/components/admin/common";
import { ROLE_LABELS, ROLE_VARIANTS, SellerStatusBadge, fmtDate } from "@/components/admin/labels";
import { UserActions } from "@/components/admin/user-actions";
import { NativeSelect } from "@/components/admin/fields";
import { Users } from "lucide-react";

export const metadata = { title: "Админка · Пользователи" };
export const dynamic = "force-dynamic";

const STATUS_FILTERS = [
  { key: "", label: "Все" },
  { key: "active", label: "Активные" },
  { key: "banned", label: "Заблокированные" },
] as const;

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireRole("ADMIN");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const role = ["USER", "SELLER", "ADMIN"].includes(strParam(sp.role)) ? strParam(sp.role) : "";
  const status = ["active", "banned"].includes(strParam(sp.status)) ? strParam(sp.status) : "";
  const page = pageParam(sp.page);

  const where: Prisma.UserWhereInput = {
    ...(role ? { role: role as "USER" | "SELLER" | "ADMIN" } : {}),
    ...(status ? { banned: status === "banned" } : {}),
    ...(q ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } }, { id: q }] } : {}),
  };
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      select: { id: true, email: true, name: true, role: true, balance: true, banned: true, bannedReason: true, createdAt: true, lastLoginAt: true, sellerProfile: { select: { status: true, shopName: true } }, _count: { select: { orders: true } } },
    }),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const base = { q, role, status };

  return (
    <>
      <PageHeader title="Пользователи" description={`Найдено: ${total}`} />
      <SearchForm action="/admin/users" q={q} placeholder="Email, имя или ID" hidden={{ status }}>
        <NativeSelect name="role" defaultValue={role} className="w-44" aria-label="Роль">
          <option value="">Все роли</option>
          {Object.entries(ROLE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </NativeSelect>
      </SearchForm>
      <FilterPills active={status} items={STATUS_FILTERS.map((s) => ({ key: s.key, label: s.label, href: href("/admin/users", { ...base, status: s.key }) }))} />

      {users.length === 0 ? (
        <EmptyState icon={<Users />} title="Никого не нашли" description="Измените поисковый запрос или фильтры." />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Пользователь</TableHead><TableHead>Роль</TableHead><TableHead className="text-right">Баланс</TableHead><TableHead className="text-right">Заказов</TableHead><TableHead>Регистрация</TableHead><TableHead className="text-right">Действия</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <p className="font-medium">{u.name ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{u.email}</p>
                  {u.banned && <p className="mt-1 text-xs text-destructive">Бан: {u.bannedReason ?? "без причины"}</p>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={ROLE_VARIANTS[u.role] ?? "outline"}>{ROLE_LABELS[u.role] ?? u.role}</Badge>
                    {u.banned && <Badge variant="destructive">Заблокирован</Badge>}
                    {u.sellerProfile && u.role === "SELLER" && <SellerStatusBadge status={u.sellerProfile.status} />}
                  </div>
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatRub(u.balance)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {u._count.orders > 0 ? <Link href={href("/admin/orders", { q: u.email })} className="hover:text-primary">{u._count.orders}</Link> : 0}
                </TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {fmtDate(u.createdAt)}
                  {u.lastLoginAt && <><br />вход {fmtDate(u.lastLoginAt)}</>}
                </TableCell>
                <TableCell><UserActions user={{ id: u.id, email: u.email, role: u.role, banned: u.banned, balanceLabel: formatRub(u.balance), isSelf: u.id === me.id }} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(p) => href("/admin/users", { ...base, page: p })} />
    </>
  );
}
