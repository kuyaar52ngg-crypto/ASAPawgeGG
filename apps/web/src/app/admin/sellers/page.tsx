import Link from "next/link";
import { Store } from "lucide-react";
import { getSetting, prisma, type Prisma } from "@asap/db";
import { SETTING_KEYS, formatRub, DEFAULT_COMMISSION_BPS } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { ADMIN_PAGE_SIZE, pageParam, strParam } from "@/server/admin/action";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterPills, Pager, SearchForm, href } from "@/components/admin/common";
import { SELLER_LABELS, SellerStatusBadge, fmtDate } from "@/components/admin/labels";
import { SellerActions } from "@/components/admin/seller-actions";

export const metadata = { title: "Админка · Продавцы" };
export const dynamic = "force-dynamic";

const STATUSES = ["PENDING", "VERIFIED", "SUSPENDED", "REJECTED"] as const;
const pct = (bps: number) => String(bps / 100).replace(".", ",");

export default async function AdminSellersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const q = strParam(sp.q);
  const status = (STATUSES as readonly string[]).includes(strParam(sp.status)) ? strParam(sp.status) : "";
  const page = pageParam(sp.page);
  const defaultBps = Number(await getSetting<number>(SETTING_KEYS.commissionDefaultBps, DEFAULT_COMMISSION_BPS)) || DEFAULT_COMMISSION_BPS;

  const where: Prisma.SellerProfileWhereInput = {
    ...(status ? { status: status as (typeof STATUSES)[number] } : {}),
    ...(q ? { OR: [{ shopName: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }, { slug: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, sellers, counts] = await Promise.all([
    prisma.sellerProfile.count({ where }),
    prisma.sellerProfile.findMany({
      where,
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: (page - 1) * ADMIN_PAGE_SIZE,
      take: ADMIN_PAGE_SIZE,
      include: { user: { select: { email: true, name: true, banned: true, _count: { select: { products: true } } } } },
    }),
    prisma.sellerProfile.groupBy({ by: ["status"], _count: true }),
  ]);
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE));
  const base = { q, status };

  return (
    <>
      <PageHeader title="Продавцы" description="Заявки на подключение, верификация и индивидуальные комиссии" />
      <SearchForm action="/admin/sellers" q={q} placeholder="Магазин, email или slug" hidden={{ status }} />
      <FilterPills
        active={status}
        items={[
          { key: "", label: "Все", href: href("/admin/sellers", { q }), count: counts.reduce((s, c) => s + c._count, 0) },
          ...STATUSES.map((s) => ({ key: s, label: SELLER_LABELS[s]!, href: href("/admin/sellers", { q, status: s }), count: countOf(s) })),
        ]}
      />
      {sellers.length === 0 ? (
        <EmptyState icon={<Store />} title="Продавцов не найдено" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow><TableHead>Магазин</TableHead><TableHead>Статус</TableHead><TableHead className="text-right">Комиссия</TableHead><TableHead className="text-right">Рейтинг</TableHead><TableHead className="text-right">Продажи</TableHead><TableHead className="text-right">Баланс (холд / доступно)</TableHead><TableHead className="text-right">Действия</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {sellers.map((s) => (
              <TableRow key={s.id}>
                <TableCell>
                  <Link href={`/seller-store/${s.slug}`} className="font-medium hover:text-primary">{s.shopName}</Link>
                  <p className="text-xs text-muted-foreground">{s.user.email} · товаров: {s.user._count.products}</p>
                  <p className="text-xs text-muted-foreground">с {fmtDate(s.createdAt)}{s.user.banned && <span className="ml-1 text-destructive">· аккаунт заблокирован</span>}</p>
                </TableCell>
                <TableCell><SellerStatusBadge status={s.status} /></TableCell>
                <TableCell className="text-right tabular-nums">{s.commissionBps !== null ? <b>{pct(s.commissionBps)}%</b> : <span className="text-muted-foreground">{pct(defaultBps)}% (общая)</span>}</TableCell>
                <TableCell className="text-right tabular-nums">{s.ratingCount ? `${s.rating.toFixed(1)} (${s.ratingCount})` : "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{s.salesCount}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{formatRub(s.holdBalance)} / {formatRub(s.availableBalance)}</TableCell>
                <TableCell>
                  <SellerActions sellerId={s.id} shopName={s.shopName} status={s.status} commissionPercent={s.commissionBps !== null ? pct(s.commissionBps) : ""} defaultPercent={pct(defaultBps)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Pager page={page} pageCount={pageCount} hrefFor={(p) => href("/admin/sellers", { ...base, page: p })} />
    </>
  );
}
