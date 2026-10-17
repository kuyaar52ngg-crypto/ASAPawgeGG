import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { prisma } from "@asap/db";
import { DELIVERY_MODE_LABELS, PLATFORMS, PRODUCT_TYPE_LABELS, REGIONS, formatRub, type DeliveryModeName, type ProductTypeName } from "@asap/shared";
import { requireRole } from "@/server/auth/session";
import { getAutoPublishThreshold, readAiModeration } from "@/server/admin/products";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DetailList, JsonBlock } from "@/components/admin/common";
import { AiVerdictBadge, ProductStatusBadge, fmtDateTime } from "@/components/admin/labels";
import { ProductModerationActions, RerunAiButton } from "@/components/admin/product-actions";
import { ProductEditForm } from "@/components/admin/product-edit-form";

export const metadata = { title: "Админка · Товар" };
export const dynamic = "force-dynamic";

const rub = (kop: number) => String(kop / 100).replace(".", ",");

export default async function AdminProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole("ADMIN");
  const { id } = await params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      category: { select: { name: true } },
      seller: { select: { id: true, email: true, name: true, sellerProfile: { select: { id: true, shopName: true, slug: true, status: true } } } },
      variants: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!product) notFound();

  const [stock, aiLogs, categories, threshold, salesAgg] = await Promise.all([
    prisma.stockItem.groupBy({ by: ["status"], where: { productId: id }, _count: true }),
    prisma.aiLog.findMany({ where: { task: "moderation", input: { path: ["productId"], equals: id } }, orderBy: { createdAt: "desc" }, take: 8 }),
    prisma.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, parent: { select: { name: true } } } }),
    getAutoPublishThreshold(),
    prisma.orderItem.aggregate({ where: { productId: id, order: { paidAt: { not: null } }, status: { not: "REFUNDED" } }, _sum: { quantity: true, total: true } }),
  ]);
  const ai = readAiModeration(product.aiModeration);
  const stockOf = (s: string) => stock.find((x) => x.status === s)?._count ?? 0;
  const attrs = product.aiModeration as { provider?: string; model?: string; mock?: boolean; checkedAt?: string } | null;

  return (
    <>
      <PageHeader
        title={product.title}
        description={`${product.category.name} · ${PRODUCT_TYPE_LABELS[product.type as ProductTypeName]} · ${DELIVERY_MODE_LABELS[product.deliveryMode as DeliveryModeName]}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <ProductStatusBadge status={product.status} />
            {product.status === "ACTIVE" && (
              <Link href={`/product/${product.slug}`} className="inline-flex items-center gap-1 text-sm text-primary hover:underline" target="_blank">На витрине <ExternalLink className="size-3.5" /></Link>
            )}
          </div>
        }
      />
      <p className="-mt-3 mb-5 text-sm"><Link href="/admin/products" className="text-muted-foreground hover:text-foreground">← К списку товаров</Link></p>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <ProductModerationActions productId={product.id} title={product.title} status={product.status} />
        <RerunAiButton productId={product.id} />
      </div>
      {product.status === "REJECTED" && product.moderationNote && <p className="mb-6 rounded-xl bg-destructive/10 px-4 py-3 text-sm"><b>Причина отклонения:</b> {product.moderationNote}</p>}

      <div className="mb-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader><CardTitle>Карточка</CardTitle></CardHeader>
          <CardContent className="grid gap-5">
            <div className="flex gap-4">
              {product.coverImage && <Image src={product.coverImage} alt="" width={160} height={160} className="size-32 shrink-0 rounded-xl object-cover" unoptimized />}
              <DetailList
                items={[
                  { label: "Продавец", value: product.seller.sellerProfile ? <Link className="hover:text-primary" href={`/admin/sellers?q=${encodeURIComponent(product.seller.email)}`}>{product.seller.sellerProfile.shopName}</Link> : product.seller.email },
                  { label: "Цена", value: `${product.variants.length ? "от " : ""}${formatRub(product.price)}${product.oldPrice ? ` (было ${formatRub(product.oldPrice)})` : ""}` },
                  { label: "Платформа / регион", value: `${product.platform ?? "—"} / ${product.region ?? "—"}` },
                  { label: "Продано", value: `${salesAgg._sum.quantity ?? 0} шт. на ${formatRub(salesAgg._sum.total ?? 0)}` },
                  { label: "Остатки", value: product.deliveryMode === "AUTO_STOCK" ? `${stockOf("AVAILABLE")} в наличии · ${stockOf("RESERVED")} в резерве · ${stockOf("SOLD")} продано` : "не требуются" },
                  { label: "Создан / опубликован", value: `${fmtDateTime(product.createdAt)} / ${fmtDateTime(product.publishedAt)}` },
                ]}
              />
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Описание продавца (как текст)</p>
              <p className="max-h-72 overflow-auto rounded-xl bg-foreground/[0.05] p-3 text-sm leading-relaxed whitespace-pre-wrap break-words">{product.description}</p>
            </div>
            {product.variants.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Варианты</p>
                <ul className="grid gap-1 text-sm">
                  {product.variants.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 rounded-lg bg-foreground/[0.04] px-3 py-1.5"><span>{v.title}{!v.isActive && <Badge variant="secondary" className="ml-2">выключен</Badge>}</span><b className="tabular-nums">{formatRub(v.price)}</b></li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI-модерация</CardTitle>
            <CardDescription>Порог автопубликации: {threshold}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {ai ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <AiVerdictBadge verdict={ai.verdict} />
                  <span className="font-display text-2xl font-bold tabular-nums">{ai.score}<span className="text-sm text-muted-foreground">/100</span></span>
                </div>
                {ai.reasons.length > 0 ? <ul className="list-disc pl-5 text-sm">{ai.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : <p className="text-sm text-muted-foreground">Причины не указаны</p>}
                {attrs?.provider && <p className="text-xs text-muted-foreground">{attrs.mock ? "Правила (без LLM)" : `${attrs.provider} · ${attrs.model}`}{attrs.checkedAt && ` · ${fmtDateTime(attrs.checkedAt)}`}</p>}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Товар ещё не проверялся AI. Нажмите «Перепроверить AI».</p>
            )}
            {aiLogs.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">История проверок</p>
                <ul className="grid gap-1.5 text-xs">
                  {aiLogs.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-2 rounded-lg bg-foreground/[0.04] px-2.5 py-1.5">
                      <span>{fmtDateTime(l.createdAt)} · {l.provider}</span>
                      <span className={l.ok ? "" : "text-destructive"}>{l.ok ? JSON.stringify((l.output as { verdict?: string; score?: number } | null) ?? {}).slice(0, 60) : "ошибка"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {product.aiModeration && <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Сырой ответ</summary><JsonBlock value={product.aiModeration} className="mt-2" /></details>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Редактирование</CardTitle><CardDescription>Изменения сразу видны на витрине и пишутся в аудит-лог</CardDescription></CardHeader>
        <CardContent>
          <ProductEditForm
            product={{
              id: product.id,
              title: product.title,
              categoryId: product.categoryId,
              shortDescription: product.shortDescription ?? "",
              description: product.description,
              platform: product.platform ?? "",
              region: product.region ?? "",
              tags: product.tags.join(", "),
              coverImage: product.coverImage ?? "",
              isFeatured: product.isFeatured,
              price: product.variants.length ? null : rub(product.price),
              oldPrice: product.oldPrice ? rub(product.oldPrice) : "",
              variants: product.variants.map((v) => ({ id: v.id, title: v.title, price: rub(v.price), isActive: v.isActive })),
            }}
            categories={categories.map((c) => ({ id: c.id, label: c.parent ? `${c.parent.name} › ${c.name}` : c.name }))}
            platforms={PLATFORMS.map((p) => ({ value: p.value, label: p.label }))}
            regions={REGIONS.map((r) => ({ value: r.value, label: r.label }))}
          />
        </CardContent>
      </Card>
    </>
  );
}
