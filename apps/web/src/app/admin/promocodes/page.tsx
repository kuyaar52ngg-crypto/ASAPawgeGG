import { prisma } from "@asap/db";
import { formatRub } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate } from "@/components/admin/labels";
import { PromoFormDialog, PromoRowActions } from "@/components/admin/promo-actions";

export const metadata = { title: "Админка · Промокоды" };
export const dynamic = "force-dynamic";

const rub = (kop: number) => String(kop / 100).replace(".", ",");

export default async function AdminPromocodesPage() {
  await requireRole("ADMIN");
  const promos = await prisma.promoCode.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { orders: true } } } });
  const now = Date.now();

  return (
    <>
      <PageHeader title="Промокоды" description="Скидки на корзину. Использование засчитывается после оплаты заказа" actions={<PromoFormDialog />} />
      <Table>
        <TableHeader>
          <TableRow><TableHead>Код</TableHead><TableHead>Скидка</TableHead><TableHead>Условия</TableHead><TableHead className="text-right">Использовано</TableHead><TableHead>Срок</TableHead><TableHead>Статус</TableHead><TableHead className="text-right">Действия</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {promos.map((p) => {
            const expired = !!p.expiresAt && p.expiresAt.getTime() < now;
            const exhausted = p.maxUses !== null && p.usedCount >= p.maxUses;
            return (
              <TableRow key={p.id}>
                <TableCell className="font-mono font-semibold">{p.code}</TableCell>
                <TableCell className="font-semibold">{p.type === "PERCENT" ? `${p.value}%` : formatRub(p.value)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {p.minOrder > 0 ? `от ${formatRub(p.minOrder)}` : "без минимума"}
                  {p.maxDiscount ? ` · до ${formatRub(p.maxDiscount)}` : ""} · {p.perUserLimit} на пользователя
                </TableCell>
                <TableCell className="text-right tabular-nums">{p.usedCount}{p.maxUses !== null ? ` / ${p.maxUses}` : ""}</TableCell>
                <TableCell className="text-xs">{p.expiresAt ? fmtDate(p.expiresAt) : "бессрочно"}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {!p.isActive ? <Badge variant="secondary">Отключён</Badge> : expired ? <Badge variant="warning">Истёк</Badge> : exhausted ? <Badge variant="warning">Лимит исчерпан</Badge> : <Badge variant="success">Активен</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <PromoFormDialog promo={{ id: p.id, code: p.code, type: p.type, value: p.type === "PERCENT" ? String(p.value) : rub(p.value), minOrder: p.minOrder ? rub(p.minOrder) : "", maxDiscount: p.maxDiscount ? rub(p.maxDiscount) : "", maxUses: p.maxUses === null ? "" : String(p.maxUses), perUserLimit: p.perUserLimit, expiresAt: p.expiresAt ? p.expiresAt.toISOString().slice(0, 10) : "", isActive: p.isActive }} />
                    <PromoRowActions id={p.id} code={p.code} isActive={p.isActive} deletable={p.usedCount === 0 && p._count.orders === 0} />
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
          {promos.length === 0 && <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Промокодов пока нет</TableCell></TableRow>}
        </TableBody>
      </Table>
    </>
  );
}
