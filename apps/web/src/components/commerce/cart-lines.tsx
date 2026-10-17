"use client";
import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Minus, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Price } from "@/components/ui/price";
import { toast } from "@/components/ui/sonner";
import { formatRub } from "@asap/shared";
import { removeFromCart, updateCartItemMeta, updateQty } from "@/server/cart/actions";
import { INPUT_LABELS } from "@/server/cart/meta";
import type { CartLine } from "@/server/cart/service";

export function CartLines({ lines }: { lines: CartLine[] }) {
  return (
    <ul className="space-y-3">
      {lines.map((l) => (
        <CartLineRow key={l.id} line={l} />
      ))}
    </ul>
  );
}

function CartLineRow({ line }: { line: CartLine }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [input, setInput] = React.useState(line.meta?.steamLogin ?? line.meta?.buyerInput ?? "");

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Не удалось выполнить действие");
      router.refresh();
    });
  }

  const setQty = (q: number) => run(() => updateQty({ itemId: line.id, quantity: q }));
  const remove = () => run(() => removeFromCart({ itemId: line.id }));
  const saveInput = () => {
    const key = line.requiredInput;
    if (!key) return;
    const value = input.trim();
    if (value === (line.meta?.[key] ?? "")) return;
    run(() => updateCartItemMeta({ itemId: line.id, [key]: value }));
  };

  const needsInput = line.requiredInput ? INPUT_LABELS[line.requiredInput] : null;
  const missingInput = line.requiredInput && !line.meta?.[line.requiredInput];

  return (
    <li className="glass rounded-2xl p-3.5 sm:p-4" data-pending={pending || undefined}>
      <div className="flex gap-3.5 sm:gap-4">
        <Link href={`/product/${line.slug}`} className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted sm:size-24">
          {line.image && <Image src={line.image} alt={line.title} fill sizes="96px" className="object-cover" />}
        </Link>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/product/${line.slug}`} className="line-clamp-2 text-sm font-semibold hover:text-primary sm:text-base">
                {line.title}
              </Link>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {line.variantTitle && <Badge variant="default">{line.variantTitle}</Badge>}
                {line.topupAmount != null && <Badge variant="default">Пополнение на {formatRub(line.topupAmount)}</Badge>}
                {line.platform && <Badge variant="secondary">{line.platform}</Badge>}
                {line.region && <Badge variant="outline">{line.region}</Badge>}
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={remove} disabled={pending} aria-label={`Удалить «${line.title}» из корзины`} className="text-muted-foreground hover:text-destructive">
              <Trash2 />
            </Button>
          </div>

          <div className="mt-auto flex flex-wrap items-end justify-between gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-border bg-foreground/[0.04] p-0.5">
              <Button variant="ghost" size="icon-sm" disabled={pending || line.quantity <= 1} onClick={() => setQty(line.quantity - 1)} aria-label="Уменьшить количество">
                <Minus />
              </Button>
              <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-live="polite">{line.quantity}</span>
              <Button variant="ghost" size="icon-sm" disabled={pending || line.quantity >= line.maxQty} onClick={() => setQty(line.quantity + 1)} aria-label="Увеличить количество">
                <Plus />
              </Button>
            </div>
            <div className="text-right">
              <Price price={line.lineTotal} oldPrice={line.oldPrice ? line.oldPrice * line.quantity : null} />
              {line.quantity > 1 && <p className="text-xs text-muted-foreground">{formatRub(line.unitPrice)} × {line.quantity}</p>}
            </div>
          </div>
        </div>
      </div>

      {needsInput && line.requiredInput && (
        <div className="mt-3 border-t border-border/60 pt-3">
          <label htmlFor={`meta-${line.id}`} className="mb-1.5 block text-xs font-medium text-muted-foreground">
            {needsInput.label} <span className="text-destructive">*</span>
          </label>
          <Input
            id={`meta-${line.id}`}
            value={input}
            maxLength={line.requiredInput === "buyerInput" ? 200 : 64}
            placeholder={needsInput.placeholder}
            aria-invalid={missingInput ? true : undefined}
            onChange={(e) => setInput(e.target.value)}
            onBlur={saveInput}
            onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), saveInput())}
            className="h-10"
          />
          <p className="mt-1 text-xs text-muted-foreground">{needsInput.hint}</p>
        </div>
      )}

      {line.problem && (
        <p role="alert" className="mt-3 flex items-center gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" /> {line.problem}
        </p>
      )}
    </li>
  );
}
