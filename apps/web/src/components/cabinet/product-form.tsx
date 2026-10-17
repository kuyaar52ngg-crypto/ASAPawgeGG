"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Save, Send, Sparkles, Trash2 } from "lucide-react";
import { DELIVERY_MODE_LABELS, PLATFORMS, PRODUCT_TYPES, PRODUCT_TYPE_LABELS, REGIONS, formatRub, rubToKopecks, type ProductTypeName } from "@asap/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/components/ui/sonner";
import { describeProductAction, saveProductAction } from "@/app/seller/actions";
import { ProductStatusBadge } from "./labels";
import { SelectField } from "./select-field";

export interface CategoryOption {
  id: string;
  label: string;
}

export interface ProductFormInitial {
  id: string;
  status: string;
  title: string;
  categoryId: string;
  type: string;
  deliveryMode: string;
  platform: string | null;
  region: string | null;
  shortDescription: string;
  description: string;
  instructions: string;
  images: string[];
  tags: string[];
  /** kopecks */
  price: number;
  oldPrice: number | null;
  variants: { id: string; title: string; price: number; oldPrice: number | null; isActive: boolean }[];
  moderationNote: string | null;
  aiModeration: { score?: number; verdict?: string; reasons?: string[] } | null;
}

interface VariantDraft {
  key: string;
  id?: string;
  title: string;
  price: string;
  oldPrice: string;
  isActive: boolean;
}

const NONE = "__none";
const rub = (k: number | null | undefined) => (k == null ? "" : String(k / 100).replace(".", ","));
const toKopecks = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  try {
    const k = rubToKopecks(t);
    return Number.isFinite(k) ? k : Number.NaN;
  } catch {
    return Number.NaN;
  }
};
let seq = 0;
const newKey = () => `v${++seq}`;

export function ProductForm({ categories, initial, verified }: { categories: CategoryOption[]; initial?: ProductFormInitial; verified: boolean }) {
  const router = useRouter();
  const [title, setTitle] = React.useState(initial?.title ?? "");
  const [categoryId, setCategoryId] = React.useState(initial?.categoryId ?? "");
  const [type, setType] = React.useState(initial?.type ?? "KEY");
  const [deliveryMode, setDeliveryMode] = React.useState(initial?.deliveryMode === "MANUAL" ? "MANUAL" : "AUTO_STOCK");
  const [platform, setPlatform] = React.useState(initial?.platform ?? NONE);
  const [region, setRegion] = React.useState(initial?.region ?? NONE);
  const [shortDescription, setShortDescription] = React.useState(initial?.shortDescription ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [instructions, setInstructions] = React.useState(initial?.instructions ?? "");
  const [images, setImages] = React.useState((initial?.images ?? []).join("\n"));
  const [tags, setTags] = React.useState((initial?.tags ?? []).join(", "));
  const [price, setPrice] = React.useState(rub(initial?.price));
  const [oldPrice, setOldPrice] = React.useState(rub(initial?.oldPrice));
  const [variants, setVariants] = React.useState<VariantDraft[]>(
    (initial?.variants ?? []).map((v) => ({ key: newKey(), id: v.id, title: v.title, price: rub(v.price), oldPrice: rub(v.oldPrice), isActive: v.isActive })),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [saving, startSave] = React.useTransition();
  const [aiPending, startAi] = React.useTransition();
  const [pendingIntent, setPendingIntent] = React.useState<"draft" | "submit" | null>(null);

  const hasVariants = variants.length > 0;
  const status = initial?.status;
  const live = status === "ACTIVE";
  const imageList = images.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  function buildPayload(intent: "draft" | "submit") {
    const variantsPayload = variants.map((v) => ({ id: v.id, title: v.title, price: toKopecks(v.price), oldPrice: toKopecks(v.oldPrice), isActive: v.isActive }));
    const priceK = hasVariants ? Math.min(...variantsPayload.filter((v) => v.isActive && v.price != null).map((v) => v.price as number), Number.MAX_SAFE_INTEGER) : toKopecks(price);
    if (variantsPayload.some((v) => Number.isNaN(v.price) || v.price == null || Number.isNaN(v.oldPrice))) return { error: "Проверьте цены вариантов — используйте число, например 1499 или 1499,50" } as const;
    if (!hasVariants && (priceK == null || Number.isNaN(priceK))) return { error: "Укажите цену числом, например 1499 или 1499,50" } as const;
    const oldK = toKopecks(oldPrice);
    if (!hasVariants && Number.isNaN(oldK)) return { error: "Старая цена указана некорректно" } as const;
    return {
      payload: {
        title,
        categoryId,
        type,
        deliveryMode,
        platform: platform === NONE ? null : platform,
        region: region === NONE ? null : region,
        shortDescription: shortDescription || null,
        description,
        instructions,
        images: imageList,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        price: hasVariants ? (priceK === Number.MAX_SAFE_INTEGER ? 100 : priceK) : priceK,
        oldPrice: hasVariants ? null : oldK,
        variants: variantsPayload,
        intent,
      },
    } as const;
  }

  function save(intent: "draft" | "submit") {
    setError(null);
    setFieldErrors({});
    const built = buildPayload(intent);
    if (built.error) {
      setError(built.error);
      return;
    }
    setPendingIntent(intent);
    startSave(async () => {
      const res = await saveProductAction(initial?.id ?? null, built.payload);
      setPendingIntent(null);
      if (res.ok) {
        toast.success(res.data.message);
        if (initial) router.refresh();
        else router.push(res.data.status === "DRAFT" ? `/seller/products/${res.data.id}/edit` : "/seller/products");
      } else {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });
  }

  function generate() {
    if (title.trim().length < 3) return toast.error("Сначала введите название товара");
    if (description.trim().length > 20 && !window.confirm("Заменить текущее описание сгенерированным?")) return;
    startAi(async () => {
      const res = await describeProductAction({
        title,
        type,
        deliveryMode,
        platform: platform === NONE ? null : platform,
        region: region === NONE ? null : region,
        categoryName: categories.find((c) => c.id === categoryId)?.label ?? null,
        notes: shortDescription || undefined,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setDescription(res.data.description);
      if (!shortDescription && res.data.shortDescription) setShortDescription(res.data.shortDescription);
      if (!tags.trim() && res.data.tags?.length) setTags(res.data.tags.join(", "));
      if (res.data.source === "ai") toast.success(res.data.mock ? "Описание сгенерировано (тестовый AI-режим, ключи провайдера не подключены)" : `Описание сгенерировано${res.data.provider ? ` · ${res.data.provider}` : ""}`);
      else toast.info("AI сейчас недоступен — подставлен шаблон описания. Отредактируйте его под свой товар.");
    });
  }

  const updateVariant = (key: string, patch: Partial<VariantDraft>) => setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));
  const err = (k: string) => fieldErrors[k]?.[0];

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save("draft");
      }}
      className="grid gap-6 xl:grid-cols-[1fr_320px]"
    >
      <div className="space-y-6">
        {error && <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

        <Card>
          <CardHeader><CardTitle>Основное</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="Название" htmlFor="p-title" error={err("title")} className="sm:col-span-2">
              <Input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} required placeholder="Например: Cyberpunk 2077 — Steam Key (RU)" />
            </Field>
            <Field label="Категория" error={err("categoryId")}>
              <SelectField id="p-category" label="Категория" value={categoryId} onChange={setCategoryId} placeholder="Выберите категорию" options={categories.map((c) => ({ value: c.id, label: c.label }))} />
            </Field>
            <Field label="Тип товара" error={err("type")}>
              <SelectField label="Тип товара" value={type} onChange={setType} options={PRODUCT_TYPES.map((t) => ({ value: t, label: PRODUCT_TYPE_LABELS[t as ProductTypeName] }))} />
            </Field>
            <Field label="Способ выдачи" hint={deliveryMode === "AUTO_STOCK" ? "Ключи загружаются на склад и выдаются мгновенно" : "Вы вручную отправляете данные покупателю из раздела «Заказы»"} error={err("deliveryMode")}>
              <SelectField label="Способ выдачи" value={deliveryMode} onChange={setDeliveryMode} options={[{ value: "AUTO_STOCK", label: DELIVERY_MODE_LABELS.AUTO_STOCK }, { value: "MANUAL", label: DELIVERY_MODE_LABELS.MANUAL }]} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Платформа" error={err("platform")}>
                <SelectField label="Платформа" value={platform} onChange={setPlatform} options={[{ value: NONE, label: "Не указана" }, ...PLATFORMS.map((p) => ({ value: p.value, label: p.label }))]} />
              </Field>
              <Field label="Регион" error={err("region")}>
                <SelectField label="Регион" value={region} onChange={setRegion} options={[{ value: NONE, label: "Не указан" }, ...REGIONS.map((r) => ({ value: r.value, label: r.label }))]} />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Описание</CardTitle>
              <CardDescription>Что получает покупатель, особенности активации, ограничения.</CardDescription>
            </div>
            <Button type="button" variant="glass" size="sm" onClick={generate} loading={aiPending}><Sparkles /> AI: сгенерировать описание</Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Краткое описание" htmlFor="p-short" hint="До 240 символов — показывается в карточке" error={err("shortDescription")}>
              <Input id="p-short" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} maxLength={240} />
            </Field>
            <Field label="Полное описание" htmlFor="p-desc" error={err("description")} hint="Минимум 30 символов. Поддерживается простой Markdown.">
              <Textarea id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-48" maxLength={10000} required />
            </Field>
            <Field label="Инструкция по активации" htmlFor="p-instr" hint="Один шаг на строку — покажем покупателю на странице товара" error={err("instructions")}>
              <Textarea id="p-instr" value={instructions} onChange={(e) => setInstructions(e.target.value)} className="min-h-28" placeholder={"Откройте Steam → Игры → Активировать продукт\nВведите полученный ключ\nНажмите «Далее»"} />
            </Field>
            <Field label="Теги" htmlFor="p-tags" hint="Через запятую — помогают поиску" error={err("tags")}>
              <Input id="p-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Изображения</CardTitle>
            <CardDescription>Ссылки (https), по одной на строку. Первая — обложка. Разрешённые домены: picsum.photos, placehold.co, images.unsplash.com, steamstatic.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Field error={err("images")}>
              <Textarea value={images} onChange={(e) => setImages(e.target.value)} className="min-h-24 font-mono text-xs" placeholder="https://images.unsplash.com/photo-…" aria-label="Ссылки на изображения" />
            </Field>
            {imageList.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {imageList.slice(0, 10).map((src, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={i} src={src} alt="" className="size-16 rounded-lg border border-border object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.opacity = "0.25")} />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Цена и варианты</CardTitle>
              <CardDescription>{hasVariants ? "Цена товара = минимальная цена активного варианта. Покупатель выбирает вариант на странице товара." : "Одна цена для всего товара, либо добавьте варианты (номинал, срок подписки, издание)."}</CardDescription>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setVariants((vs) => [...vs, { key: newKey(), title: "", price: "", oldPrice: "", isActive: true }])}><Plus /> Вариант</Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {!hasVariants && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Цена, ₽" htmlFor="p-price" error={err("price")}>
                  <Input id="p-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} required placeholder="1499" />
                </Field>
                <Field label="Старая цена, ₽" htmlFor="p-old" hint="Необязательно — покажем скидку" error={err("oldPrice")}>
                  <Input id="p-old" inputMode="decimal" value={oldPrice} onChange={(e) => setOldPrice(e.target.value)} placeholder="1999" />
                </Field>
              </div>
            )}
            {err("variants") && <p className="text-sm text-destructive">{err("variants")}</p>}
            {variants.map((v, i) => (
              <div key={v.key} className="grid items-end gap-3 rounded-xl border border-border p-3 sm:grid-cols-[1fr_120px_120px_auto_auto]">
                <Field label={i === 0 ? "Название варианта" : undefined}><Input value={v.title} onChange={(e) => updateVariant(v.key, { title: e.target.value })} placeholder="Например: 3 месяца" aria-label="Название варианта" /></Field>
                <Field label={i === 0 ? "Цена, ₽" : undefined}><Input inputMode="decimal" value={v.price} onChange={(e) => updateVariant(v.key, { price: e.target.value })} aria-label="Цена варианта" /></Field>
                <Field label={i === 0 ? "Старая, ₽" : undefined}><Input inputMode="decimal" value={v.oldPrice} onChange={(e) => updateVariant(v.key, { oldPrice: e.target.value })} aria-label="Старая цена варианта" /></Field>
                <label className="flex h-11 items-center gap-2 text-xs text-muted-foreground"><Switch checked={v.isActive} onCheckedChange={(c) => updateVariant(v.key, { isActive: c })} aria-label="Активен" /> Активен</label>
                <Button type="button" variant="ghost" size="icon" onClick={() => setVariants((vs) => vs.filter((x) => x.key !== v.key))} aria-label="Удалить вариант"><Trash2 /></Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
        <Card>
          <CardHeader><CardTitle className="text-base">Публикация</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {status && (
              <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Статус</span><ProductStatusBadge status={status} /></div>
            )}
            {live && <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">Изменение названия, описания, категории, изображений или вариантов отправит товар на повторную модерацию. Правка цены применяется сразу.</p>}
            {initial?.moderationNote && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-xs text-destructive"><span className="font-semibold">Комментарий модератора:</span> {initial.moderationNote}</p>}
            {initial?.aiModeration && (
              <div className="rounded-xl bg-foreground/[0.04] px-3 py-2 text-xs text-muted-foreground">
                <p className="mb-1 font-semibold text-foreground">AI-модерация{typeof initial.aiModeration.score === "number" ? `: ${initial.aiModeration.score}/100` : ""} {initial.aiModeration.verdict && <Badge variant={initial.aiModeration.verdict === "approve" ? "success" : initial.aiModeration.verdict === "reject" ? "destructive" : "warning"}>{initial.aiModeration.verdict}</Badge>}</p>
                {initial.aiModeration.reasons?.length ? <ul className="list-disc pl-4">{initial.aiModeration.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : null}
              </div>
            )}
            {!verified && <p className="rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning">Профиль ещё не подтверждён: можно сохранять черновики, а отправка на модерацию станет доступна после проверки.</p>}

            {live ? (
              <Button type="button" className="w-full" loading={saving} onClick={() => save("draft")}><Save /> Сохранить изменения</Button>
            ) : (
              <>
                <Button type="button" className="w-full" disabled={!verified || saving} loading={saving && pendingIntent === "submit"} onClick={() => save("submit")}><Send /> {status === "PENDING_REVIEW" ? "Сохранить и перепроверить" : "Отправить на модерацию"}</Button>
                <Button type="submit" variant="outline" className="w-full" loading={saving && pendingIntent === "draft"}><Save /> Сохранить черновик</Button>
              </>
            )}
            {initial && deliveryMode === "AUTO_STOCK" && (
              <Button asChild variant="ghost" className="w-full"><Link href={`/seller/products/${initial.id}/stock`}>Склад ключей →</Link></Button>
            )}
            <p className="text-xs text-muted-foreground">После отправки AI проверяет категорию, запрещённый контент и качество описания. Хорошие карточки публикуются автоматически, спорные — проверяет администратор.</p>
          </CardContent>
        </Card>
        {price && !hasVariants && Number.isFinite(toKopecks(price)) && <p className="px-1 text-xs text-muted-foreground">Покупатель увидит цену: {formatRub(toKopecks(price) ?? 0)}</p>}
      </aside>
    </form>
  );
}
