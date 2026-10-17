"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SlidersHorizontal, X } from "lucide-react";
import { formatRub } from "@asap/shared/money";
import { SORT_OPTIONS } from "@asap/shared/constants";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { buildCatalogQs, type CatalogPageQuery } from "@/server/catalog/query";
import type { CatalogFacets } from "@/server/catalog/types";

type Overrides = Record<string, string | number | boolean | undefined | null>;

interface SubCategory {
  slug: string;
  name: string;
}

interface Props {
  /** `/catalog`, `/catalog/steam-klyuchi` or `/search` */
  basePath: string;
  query: Omit<CatalogPageQuery, "pageSize">;
  facets: CatalogFacets;
  subCategories?: SubCategory[];
  /** show "relevance" in the sort list (search page) */
  withRelevance?: boolean;
  activeCount: number;
}

function useNavigate(basePath: string, query: Props["query"], withRelevance?: boolean) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const go = React.useCallback(
    (overrides: Overrides) => {
      const qs = buildCatalogQs(query, { page: undefined, ...overrides }, { defaultSort: withRelevance ? "relevance" : "popular" });
      startTransition(() => router.push(`${basePath}${qs}`, { scroll: false }));
    },
    [basePath, query, router, withRelevance],
  );
  return { go, pending };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-2.5 border-b border-border pb-5 last:border-0 last:pb-0">
      <legend className="mb-2 font-display text-[13px] font-semibold tracking-wide uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

function OptionList({ options, value, onChange }: { options: CatalogFacets["platforms"]; value?: string; onChange: (v: string | undefined) => void }) {
  const [all, setAll] = React.useState(false);
  const shown = all ? options : options.slice(0, 6);
  return (
    <div className="space-y-1">
      {shown.map((o) => {
        const checked = value === o.value;
        const id = `f-${o.value}`;
        return (
          <label key={o.value} htmlFor={id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors hover:bg-foreground/5", checked && "bg-primary/10")}>
            <Checkbox id={id} checked={checked} onCheckedChange={(c) => onChange(c ? o.value : undefined)} />
            <span className="flex-1">{o.label}</span>
            <span className="text-xs text-muted-foreground">{o.count}</span>
          </label>
        );
      })}
      {options.length > 6 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="cursor-pointer px-2 text-xs font-semibold text-primary hover:underline">
          {all ? "Свернуть" : `Показать все (${options.length})`}
        </button>
      )}
    </div>
  );
}

function PriceFields({ query, facets, onApply }: { query: Props["query"]; facets: CatalogFacets; onApply: (min?: number, max?: number) => void }) {
  const toRub = (k?: number) => (k === undefined ? "" : String(Math.round(k / 100)));
  const [min, setMin] = React.useState(toRub(query.minPrice));
  const [max, setMax] = React.useState(toRub(query.maxPrice));

  const apply = () => {
    const a = min === "" ? undefined : Math.max(0, Math.round(Number(min) * 100));
    const b = max === "" ? undefined : Math.max(0, Math.round(Number(max) * 100));
    if ((a !== undefined && Number.isNaN(a)) || (b !== undefined && Number.isNaN(b))) return;
    onApply(a, b !== undefined && a !== undefined && b < a ? a : b);
  };
  const cls = "h-10 w-full rounded-xl border border-input bg-foreground/[0.04] px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="space-y-2"
    >
      <div className="flex items-center gap-2">
        <input inputMode="numeric" aria-label="Цена от, ₽" placeholder={`от ${Math.floor(facets.priceMin / 100)}`} value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} onBlur={apply} className={cls} />
        <span className="text-muted-foreground">–</span>
        <input inputMode="numeric" aria-label="Цена до, ₽" placeholder={`до ${Math.ceil(facets.priceMax / 100)}`} value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} onBlur={apply} className={cls} />
      </div>
      <p className="text-xs text-muted-foreground">
        Диапазон: {formatRub(facets.priceMin)} – {formatRub(facets.priceMax)}
      </p>
      <button type="submit" className="sr-only">
        Применить
      </button>
    </form>
  );
}

function FilterPanel({ basePath, query, facets, subCategories, withRelevance }: Props) {
  const { go, pending } = useNavigate(basePath, query, withRelevance);
  const hasAny = Boolean(query.platform || query.region || query.type || query.minPrice !== undefined || query.maxPrice !== undefined || query.inStock || query.discount);

  return (
    <div className={cn("space-y-5 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      {subCategories && subCategories.length > 0 && (
        <Section title="Подкатегории">
          <ul className="space-y-0.5">
            {subCategories.map((c) => (
              <li key={c.slug}>
                <Link href={`/catalog/${c.slug}${buildCatalogQs(query, { page: undefined }, { omit: ["category"], defaultSort: withRelevance ? "relevance" : "popular" })}`} className="block rounded-lg px-2 py-1.5 text-sm hover:bg-foreground/5 hover:text-primary">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Наличие и скидки">
        <label className="flex cursor-pointer items-center gap-2.5 px-2 text-sm">
          <Checkbox checked={!!query.inStock} onCheckedChange={(c) => go({ inStock: c === true ? true : undefined })} />
          Только в наличии
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 px-2 text-sm">
          <Checkbox checked={!!query.discount} onCheckedChange={(c) => go({ discount: c === true ? true : undefined })} />
          Только со скидкой
        </label>
      </Section>

      {facets.types.length > 1 && (
        <Section title="Тип товара">
          <OptionList options={facets.types} value={query.type} onChange={(v) => go({ type: v })} />
        </Section>
      )}
      {facets.platforms.length > 0 && (
        <Section title="Платформа">
          <OptionList options={facets.platforms} value={query.platform} onChange={(v) => go({ platform: v })} />
        </Section>
      )}
      {facets.regions.length > 0 && (
        <Section title="Регион активации">
          <OptionList options={facets.regions} value={query.region} onChange={(v) => go({ region: v })} />
        </Section>
      )}
      <Section title="Цена, ₽">
        <PriceFields key={`${query.minPrice ?? ""}-${query.maxPrice ?? ""}`} query={query} facets={facets} onApply={(a, b) => go({ minPrice: a, maxPrice: b })} />
      </Section>

      {hasAny && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => go({ platform: undefined, region: undefined, type: undefined, minPrice: undefined, maxPrice: undefined, inStock: undefined, discount: undefined })}>
          <X /> Сбросить фильтры
        </Button>
      )}
    </div>
  );
}

/** Desktop sidebar (sticky). */
export function CatalogSidebar(props: Props) {
  return (
    <aside aria-label="Фильтры" className="glass sticky top-24 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl p-5 lg:block">
      <FilterPanel {...props} />
    </aside>
  );
}

/** Mobile: filters button + left sheet. */
export function CatalogFiltersSheet(props: Props) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="glass" size="sm" className="lg:hidden">
          <SlidersHorizontal /> Фильтры{props.activeCount > 0 && <span className="gradient-brand ml-0.5 flex size-5 items-center justify-center rounded-full text-[11px] text-white">{props.activeCount}</span>}
        </Button>
      </DialogTrigger>
      <DialogContent side="left" className="content-start gap-5">
        <DialogTitle>Фильтры</DialogTitle>
        <DialogDescription className="sr-only">Параметры отбора товаров</DialogDescription>
        <FilterPanel {...props} />
        <DialogClose asChild>
          <Button className="sticky bottom-0 w-full">Показать результаты</Button>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

/** Sort dropdown (navigates, resets page). */
export function SortSelect({ basePath, query, withRelevance }: Pick<Props, "basePath" | "query" | "withRelevance">) {
  const { go, pending } = useNavigate(basePath, query, withRelevance);
  const options = [...(withRelevance ? [{ value: "relevance", label: "По релевантности" }] : []), ...SORT_OPTIONS];
  return (
    <Select value={query.sort} onValueChange={(v) => go({ sort: v })} disabled={pending}>
      <SelectTrigger className="h-9 w-[11.5rem] text-[13px]" aria-label="Сортировка">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
