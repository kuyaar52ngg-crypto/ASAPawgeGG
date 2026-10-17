import { notFound, redirect } from "next/navigation";
import { prisma } from "@asap/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderSummary } from "@/components/commerce/order-summary";
import { PayExistingForm } from "@/components/commerce/pay-existing-form";
import { requireUser } from "@/server/auth/session";
import { listPaymentMethods } from "@/server/payments/config";
import { cancelPendingOrder } from "../../actions";

export const metadata = { title: "Оплата заказа" };
export const dynamic = "force-dynamic";

/** Pay (again) an existing PENDING order — linked from the fail page and from the buyer's order list. */
export default async function PayOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const user = await requireUser(`/checkout/pay/${orderId}`);
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: user.id },
    select: { id: true, number: true, status: true, subtotal: true, discount: true, total: true, createdAt: true, items: { select: { id: true, title: true, variantTitle: true, quantity: true, total: true, product: { select: { coverImage: true } } } } },
  });
  if (!order) notFound();
  if (order.status !== "PENDING") redirect(["CANCELLED", "FAILED"].includes(order.status) ? `/checkout/fail?order=${order.id}` : `/checkout/success?order=${order.id}`);
  const methods = await listPaymentMethods();

  return (
    <div className="container-page py-8 sm:py-10">
      <h1 className="mb-6 text-2xl font-bold sm:text-3xl">Оплата заказа {order.number}</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader><CardTitle className="text-base">Способ оплаты</CardTitle></CardHeader>
          <CardContent>
            <PayExistingForm
              orderId={order.id}
              total={order.total}
              balance={user.balance}
              methods={methods.map((m) => ({ id: m.id, label: m.label, description: m.description, available: m.available, reason: m.reason, sandbox: m.sandbox }))}
            />
          </CardContent>
        </Card>
        <aside className="lg:sticky lg:top-24">
          <Card className="gradient-border">
            <CardContent className="space-y-4 p-5 pt-5 sm:p-6 sm:pt-6">
              <OrderSummary
                lines={order.items.map((i) => ({ id: i.id, title: i.title, variantTitle: i.variantTitle, image: i.product.coverImage, quantity: i.quantity, total: i.total }))}
                subtotal={order.subtotal}
                discount={order.discount}
                total={order.total}
              />
              <p className="text-xs text-muted-foreground">Товары зарезервированы на 30 минут с момента оформления.</p>
              <form action={cancelPendingOrder}>
                <input type="hidden" name="orderId" value={order.id} />
                <Button type="submit" variant="ghost" size="sm" className="w-full text-muted-foreground">Отменить заказ</Button>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
