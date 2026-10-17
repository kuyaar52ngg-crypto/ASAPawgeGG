import Link from "next/link";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CheckoutForm } from "@/components/commerce/checkout-form";
import { requireUser } from "@/server/auth/session";
import { getCartView } from "@/server/cart/service";
import { listPaymentMethods } from "@/server/payments/config";
import { trackEvent } from "@/server/analytics/track";

export const metadata = { title: "Оформление заказа" };
export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const user = await requireUser("/checkout");
  const cart = await getCartView({ userId: user.id });

  if (cart.lines.length === 0) {
    return (
      <div className="container-page py-10">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Оформление заказа</h1>
        <EmptyState icon={<ShoppingCart />} title="Корзина пуста" description="Добавьте товары, чтобы оформить заказ." action={<Button asChild><Link href="/catalog">В каталог</Link></Button>} />
      </div>
    );
  }
  if (!cart.checkoutReady) {
    return (
      <div className="container-page py-10">
        <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Оформление заказа</h1>
        <EmptyState
          icon={<ShoppingCart />}
          title="Нужно поправить корзину"
          description="Некоторые товары недоступны или не заполнены данные для выдачи. Вернитесь в корзину и исправьте их."
          action={<Button asChild><Link href="/cart">Вернуться в корзину</Link></Button>}
        />
      </div>
    );
  }

  const methods = await listPaymentMethods();
  void trackEvent({ name: "begin_checkout", userId: user.id, path: "/checkout", properties: { value: cart.subtotal / 100, items: cart.count } });

  return (
    <div className="container-page py-8 sm:py-10">
      <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Оформление заказа</h1>
      <CheckoutForm
        lines={cart.lines.map((l) => ({ id: l.id, title: l.title, variantTitle: l.variantTitle, image: l.image, quantity: l.quantity, total: l.lineTotal }))}
        subtotal={cart.subtotal}
        email={user.email}
        balance={user.balance}
        methods={methods.map((m) => ({ id: m.id, label: m.label, description: m.description, available: m.available, reason: m.reason, sandbox: m.sandbox }))}
      />
    </div>
  );
}
