"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Clock, Minus, Plus, ShieldCheck, ShoppingCart, Zap } from "lucide-react";
import { discountPercent, formatRub } from "@asap/shared/money";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { addToCartAction } from "@/server/catalog/actions";
import { pushEcommerce, reachGoal } from "@/lib/metrika";
import { FavoriteButton } from "./favorite-button";
import { SteamLoginField, type SteamLoginStatus } from "./steam-login-field";

export interface BuyBoxVariant {
  id: string;
  title: string;
  price: number;
  oldPrice: number | null;
  /** AVAILABLE items; null = not stock-limited (provider / manual delivery) */
  stock: number | null;
}

export interface BuyBoxProps {
  product: {
    id: string;
    title: string;
    type: string;
    deliveryMode: "AUTO_STOCK" | "AUTO_PROVIDER" | "MANUAL";
    price: number;
    oldPrice: number | null;
    categoryName: string;
    isFavorite: boolean;
  };
  variants: BuyBoxVariant[];
  /** product-level stock when there are no variants */
  stock: number | null;
}

const MAX_QTY = 10;

export function BuyBox({ product, variants, stock }: BuyBoxProps) {
  const router = useRouter();
  const hasVariants = variants.length > 0;
  const firstAvailable = variants.find((v) => v.stock === null || v.stock > 0) ?? variants[0];
  const [variantId, setVariantId] = React.useState<string | undefined>(firstAvailable?.id);
  const [qtyRaw, setQty] = React.useState(1);
  const [steamLogin, setSteamLogin] = React.useState("");
  const [steamStatus, setSteamStatus] = React.useState<SteamLoginStatus>("idle");
  const [buyerInput, setBuyerInput] = React.useState("");
  const [fieldError, setFieldError] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<"cart" | "buy" | null>(null);

  const variant = hasVariants ? variants.find((v) => v.id === variantId) : undefined;
  const unit = variant?.price ?? product.price;
  const old = variant ? variant.oldPrice : product.oldPrice;
  const pct = discountPercent(unit, old);
  const available = hasVariants ? (variant ? variant.stock : 0) : stock;
  const soldOut = available !== null && available <= 0;
  const isTopup = product.type === "TOPUP";
  const needsBuyerInput = product.deliveryMode === "MANUAL";
  const maxQty = isTopup ? 1 : Math.max(1, Math.min(MAX_QTY, available ?? MAX_QTY));

  const qty = Math.min(qtyRaw, maxQty);

  async function submit(mode: "cart" | "buy") {
    const errors: Record<string, string> = {};
    if (hasVariants && !variant) errors.variant = "Выберите вариант";
    if (isTopup) {
      if (!steamLogin.trim()) errors.steamLogin = "Укажите логин Steam";
      else if (steamStatus === "invalid") errors.steamLogin = "Проверьте логин Steam";
    }
    if (needsBuyerInput && buyerInput.trim().length < 2) errors.buyerInput = "Укажите данные для выдачи";
    setFieldError(errors);
    if (Object.keys(errors).length > 0) {
      toast.error(Object.values(errors)[0]!);
      return;
    }
    setBusy(mode);
    const meta: Record<string, unknown> = {};
    if (isTopup) meta.steamLogin = steamLogin.trim();
    if (needsBuyerInput) meta.buyerInput = buyerInput.trim();
    const res = await addToCartAction({ productId: product.id, variantId: variant?.id ?? null, quantity: qty, meta: Object.keys(meta).length ? meta : null });
    setBusy(null);
    if (!res.ok) {
      setFieldError({ ...res.fieldErrors });
      toast.error(res.error);
      return;
    }
    reachGoal("add_to_cart", { productId: product.id, variantId: variant?.id });
    pushEcommerce("add", { id: product.id, name: product.title, price: unit / 100, quantity: qty, variant: variant?.title, category: product.categoryName });
    if (mode === "buy") {
      reachGoal("buy_now", { productId: product.id });
      router.push("/checkout");
    } else {
      toast.success("Добавлено в корзину", { description: variant ? `${product.title} · ${variant.title}` : product.title, action: { label: "Перейти", onClick: () => router.push("/cart") } });
      router.refresh();
    }
  }

  return (
    <div className="glass gradient-border space-y-5 rounded-2xl p-4 sm:p-6">
      {/* price */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className="font-display text-3xl font-bold sm:text-4xl">{formatRub(unit * qty)}</span>
        {old && pct > 0 && (
          <>
            <span className="pb-1 text-lg text-muted-foreground line-through">{formatRub(old * qty)}</span>
            <Badge variant="discount" className="mb-1.5 text-sm">
              -{pct}%
            </Badge>
          </>
        )}
        {qty > 1 && <span className="pb-1 text-sm text-muted-foreground">{formatRub(unit)} за шт.</span>}
      </div>

      {/* delivery + stock */}
      <div className="flex flex-wrap items-center gap-2">
        {product.deliveryMode === "AUTO_STOCK" && (
          <Badge variant="success">
            <Zap className="size-3" /> Мгновенная доставка
          </Badge>
        )}
        {product.deliveryMode === "AUTO_PROVIDER" && (
          <Badge variant="success">
            <Zap className="size-3" /> Автоматическое пополнение · 1–5 мин
          </Badge>
        )}
        {product.deliveryMode === "MANUAL" && (
          <Badge variant="warning">
            <Clock className="size-3" /> Выдача продавцом вручную
          </Badge>
        )}
        {soldOut ? (
          <Badge variant="destructive">Нет в наличии</Badge>
        ) : available !== null ? (
          <Badge variant={available <= 5 ? "warning" : "secondary"}>{available <= 5 ? `Осталось ${available} шт.` : `В наличии: ${available} шт.`}</Badge>
        ) : (
          <Badge variant="secondary">Всегда в наличии</Badge>
        )}
      </div>

      {/* variants */}
      {hasVariants && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Выберите вариант</legend>
          <div role="radiogroup" aria-label="Варианты товара" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {variants.map((v) => {
              const out = v.stock !== null && v.stock <= 0;
              const selected = v.id === variantId;
              const vp = discountPercent(v.price, v.oldPrice);
              return (
                <button
                  key={v.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={out}
                  onClick={() => (setVariantId(v.id), setFieldError((e) => ({ ...e, variant: "" })))}
                  className={cn(
                    "relative cursor-pointer rounded-xl border p-3 text-left transition-all disabled:cursor-not-allowed disabled:opacity-45",
                    selected ? "border-primary bg-primary/10 shadow-[0_0_0_1px_var(--primary),0_8px_24px_-12px_var(--glow-violet)]" : "border-border hover:border-primary/50 hover:bg-foreground/5",
                  )}
                >
                  <span className="block text-sm font-semibold">{v.title}</span>
                  <span className="mt-0.5 block text-sm">{formatRub(v.price)}</span>
                  {v.oldPrice && vp > 0 && <span className="text-xs text-muted-foreground line-through">{formatRub(v.oldPrice)}</span>}
                  {vp > 0 && <span className="gradient-brand absolute -top-2 right-2 rounded-md px-1.5 py-0.5 text-[10px] font-bold text-white">-{vp}%</span>}
                  {out && <span className="mt-0.5 block text-[11px] text-destructive">Нет в наличии</span>}
                </button>
              );
            })}
          </div>
          {fieldError.variant && <p className="mt-1.5 text-xs text-destructive">{fieldError.variant}</p>}
        </fieldset>
      )}

      {/* buyer data */}
      {isTopup && <SteamLoginField value={steamLogin} onChange={(v) => (setSteamLogin(v), setFieldError((e) => ({ ...e, steamLogin: "" })))} onStatus={setSteamStatus} error={fieldError.steamLogin || fieldError.login} id="pdp-steam-login" />}
      {needsBuyerInput && (
        <div>
          <label htmlFor="pdp-buyer-input" className="mb-1.5 block text-sm font-semibold">
            Данные для выдачи
          </label>
          <input
            id="pdp-buyer-input"
            value={buyerInput}
            onChange={(e) => (setBuyerInput(e.target.value), setFieldError((er) => ({ ...er, buyerInput: "" })))}
            maxLength={200}
            placeholder="UID, ник или email аккаунта"
            aria-invalid={Boolean(fieldError.buyerInput)}
            className="h-12 w-full rounded-xl border border-input bg-foreground/[0.04] px-4 text-[15px] outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 aria-invalid:border-destructive"
          />
          <p className={cn("mt-1.5 text-xs", fieldError.buyerInput ? "text-destructive" : "text-muted-foreground")}>{fieldError.buyerInput || "Продавцу нужны эти данные, чтобы выполнить заказ. Пароль не требуется."}</p>
        </div>
      )}

      {/* qty + actions */}
      <div className="flex flex-wrap items-center gap-3">
        {!isTopup && !soldOut && (
          <div className="flex h-12 items-center rounded-xl border border-input" role="group" aria-label="Количество">
            <button type="button" aria-label="Меньше" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))} className="flex size-12 cursor-pointer items-center justify-center rounded-l-xl transition-colors hover:bg-foreground/5 disabled:opacity-40">
              <Minus className="size-4" />
            </button>
            <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">
              {qty}
            </span>
            <button type="button" aria-label="Больше" disabled={qty >= maxQty} onClick={() => setQty((q) => Math.min(maxQty, q + 1))} className="flex size-12 cursor-pointer items-center justify-center rounded-r-xl transition-colors hover:bg-foreground/5 disabled:opacity-40">
              <Plus className="size-4" />
            </button>
          </div>
        )}
        <Button size="lg" className="min-w-40 flex-1" disabled={soldOut || busy !== null} loading={busy === "buy"} onClick={() => submit("buy")}>
          {soldOut ? "Нет в наличии" : "Купить сейчас"}
        </Button>
        <Button size="lg" variant="outline" disabled={soldOut || busy !== null} loading={busy === "cart"} onClick={() => submit("cart")} className="flex-1 sm:flex-none">
          <ShoppingCart /> В корзину
        </Button>
        <FavoriteButton productId={product.id} initial={product.isFavorite} variant="outline" />
      </div>

      {isTopup && (
        <p className="text-sm text-muted-foreground">
          Нужна другая сумма?{" "}
          <Link href="/steam" className="font-semibold text-primary hover:underline">
            Калькулятор пополнения
          </Link>
        </p>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
        Безопасная сделка: деньги переводятся продавцу только после выдачи товара. При проблеме откройте спор — вернём средства на баланс.
      </p>
    </div>
  );
}
