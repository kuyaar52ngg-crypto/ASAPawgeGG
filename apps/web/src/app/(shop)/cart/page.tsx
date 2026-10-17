import Link from "next/link";
import { ArrowRight, ShieldCheck, ShoppingCart, Zap } from "lucide-react";
import { formatRub } from "@asap/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { CartLines } from "@/components/commerce/cart-lines";
import { resolveCartOwner } from "@/server/cart/context";
import { getCartView } from "@/server/cart/service";
import { getSessionUser } from "@/server/auth/session";
import { plural } from "@/lib/utils";

export const metadata = { title: "Корзина" };
export const dynamic = "force-dynamic";

export default async function CartPage() {
  const [{ owner }, user] = await Promise.all([resolveCartOwner(), getSessionUser()]);
  const cart = await getCartView(owner);

  if (cart.lines.length === 0) {
    return (
      <div className="container-page py-10">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Корзина</h1>
        <EmptyState
          icon={<ShoppingCart />}
          title="В корзине пока пусто"
          description="Добавьте игры, подписки или пополнение Steam — мы выдадим товар сразу после оплаты."
          action={<Button asChild><Link href="/catalog">Перейти в каталог</Link></Button>}
        />
      </div>
    );
  }

  const problems = cart.lines.filter((l) => l.problem).length;
  const missing = cart.lines.filter((l) => l.requiredInput && !l.meta?.[l.requiredInput]).length;

  return (
    <div className="container-page py-8 sm:py-10">
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Корзина</h1>
        <span className="text-sm text-muted-foreground">{cart.count} {plural(cart.count, ["товар", "товара", "товаров"])}</span>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <CartLines lines={cart.lines} />

        <aside className="lg:sticky lg:top-24">
          <Card className="gradient-border">
            <CardContent className="space-y-4 p-5 pt-5 sm:p-6 sm:pt-6">
              <h2 className="font-display text-lg font-semibold">Итого</h2>
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>{cart.count} {plural(cart.count, ["товар", "товара", "товаров"])}</span>
                  <span className="tabular-nums text-foreground">{formatRub(cart.subtotal)}</span>
                </div>
                <p className="text-xs text-muted-foreground">Промокод можно применить на следующем шаге.</p>
              </div>
              <div className="flex items-baseline justify-between border-t border-border/60 pt-3">
                <span className="font-semibold">К оплате</span>
                <span className="font-display text-2xl font-bold">{formatRub(cart.subtotal)}</span>
              </div>

              {problems > 0 && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">Исправьте позиции с ошибками, чтобы продолжить.</p>}
              {problems === 0 && missing > 0 && <p role="alert" className="rounded-xl bg-warning/10 px-3 py-2 text-sm text-warning">Заполните данные для выдачи в отмеченных позициях.</p>}

              {cart.checkoutReady ? (
                <Button asChild size="lg" className="w-full">
                  <Link href="/checkout">Оформить заказ <ArrowRight /></Link>
                </Button>
              ) : (
                <Button size="lg" className="w-full" disabled>Оформить заказ</Button>
              )}
              {!user && <p className="text-center text-xs text-muted-foreground">Для оплаты потребуется войти или зарегистрироваться — корзина сохранится.</p>}

              <ul className="space-y-2 border-t border-border/60 pt-4 text-xs text-muted-foreground">
                <li className="flex items-center gap-2"><Zap className="size-4 text-accent" /> Мгновенная выдача после оплаты</li>
                <li className="flex items-center gap-2"><ShieldCheck className="size-4 text-success" /> Безопасная оплата, гарантия продавца</li>
              </ul>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
