"use client";
import * as React from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldRow, NativeSelect } from "./fields";
import { useRunAction } from "./use-run-action";
import { updateProductAction } from "@/app/admin/products/actions";

export interface EditableProduct {
  id: string;
  title: string;
  categoryId: string;
  shortDescription: string;
  description: string;
  platform: string;
  region: string;
  tags: string;
  coverImage: string;
  isFeatured: boolean;
  /** rubles as text (e.g. "1499" or "1499,50"); null when the product has variants */
  price: string | null;
  oldPrice: string;
  variants: { id: string; title: string; price: string; isActive: boolean }[];
}

export function ProductEditForm({ product, categories, platforms, regions }: { product: EditableProduct; categories: { id: string; label: string }[]; platforms: { value: string; label: string }[]; regions: { value: string; label: string }[] }) {
  const { run, pending } = useRunAction();
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [featured, setFeatured] = React.useState(product.isFeatured);
  const [variantState, setVariantState] = React.useState(product.variants);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const s = (k: string) => String(fd.get(k) ?? "");
    setError(null);
    setErrors({});
    run(
      () =>
        updateProductAction({
          productId: product.id,
          title: s("title"),
          categoryId: s("categoryId"),
          shortDescription: s("shortDescription"),
          description: s("description"),
          platform: s("platform"),
          region: s("region"),
          tags: s("tags"),
          coverImage: s("coverImage"),
          isFeatured: featured,
          price: product.price === null ? undefined : s("price"),
          oldPrice: s("oldPrice"),
          variants: variantState.map((v) => ({ id: v.id, price: v.price, isActive: v.isActive })),
        }),
      { success: "Изменения сохранены", onError: (r) => { setError(r.error); setErrors(r.fieldErrors ?? {}); } },
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FieldRow label="Название" error={errors.title?.[0]}><Input name="title" defaultValue={product.title} required minLength={3} maxLength={160} /></FieldRow>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="Категория">
          <NativeSelect name="categoryId" defaultValue={product.categoryId}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </NativeSelect>
        </FieldRow>
        <FieldRow label="Обложка (URL)" error={errors.coverImage?.[0]}><Input name="coverImage" defaultValue={product.coverImage} placeholder="https://…" /></FieldRow>
      </div>
      <FieldRow label="Краткое описание" error={errors.shortDescription?.[0]}><Input name="shortDescription" defaultValue={product.shortDescription} maxLength={240} /></FieldRow>
      <FieldRow label="Описание" error={errors.description?.[0]}><Textarea name="description" defaultValue={product.description} required minLength={10} className="min-h-40" /></FieldRow>
      <div className="grid gap-4 sm:grid-cols-2">
        <FieldRow label="Платформа">
          <NativeSelect name="platform" defaultValue={product.platform}>
            <option value="">—</option>
            {platforms.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </NativeSelect>
        </FieldRow>
        <FieldRow label="Регион">
          <NativeSelect name="region" defaultValue={product.region}>
            <option value="">—</option>
            {regions.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </NativeSelect>
        </FieldRow>
      </div>
      <FieldRow label="Теги" hint="Через запятую, до 15"><Input name="tags" defaultValue={product.tags} /></FieldRow>

      <div className="grid gap-4 sm:grid-cols-2">
        {product.price !== null ? (
          <FieldRow label="Цена, ₽" error={errors.price?.[0]}><Input name="price" defaultValue={product.price} inputMode="decimal" required /></FieldRow>
        ) : (
          <p className="self-end text-sm text-muted-foreground">Цена задаётся вариантами; в карточке показывается минимальная активная.</p>
        )}
        <FieldRow label="Старая цена, ₽" hint="Пусто — без скидки" error={errors.oldPrice?.[0]}><Input name="oldPrice" defaultValue={product.oldPrice} inputMode="decimal" /></FieldRow>
      </div>

      {variantState.length > 0 && (
        <fieldset className="grid gap-3 rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-medium">Варианты</legend>
          {variantState.map((v, i) => (
            <div key={v.id} className="grid items-center gap-3 sm:grid-cols-[1fr_140px_auto]">
              <span className="text-sm">{v.title}</span>
              <Input aria-label={`Цена: ${v.title}`} value={v.price} inputMode="decimal" onChange={(e) => setVariantState((s) => s.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={v.isActive} onCheckedChange={(c) => setVariantState((s) => s.map((x, j) => (j === i ? { ...x, isActive: c === true } : x)))} /> Активен
              </label>
            </div>
          ))}
        </fieldset>
      )}

      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={featured} onCheckedChange={(c) => setFeatured(c === true)} /> Показывать в «Хитах» на главной
      </label>
      {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div><Button type="submit" loading={pending}>{!pending && <Save />} Сохранить</Button></div>
    </form>
  );
}
