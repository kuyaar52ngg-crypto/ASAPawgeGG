import "server-only";
import { Prisma, prisma, getSetting } from "@asap/db";
import { generateOrderNumber, SETTING_KEYS } from "@asap/shared";
import { env } from "@/lib/env";
import { getSteamFeePercent } from "@/server/catalog/steam";
import { hasRequiredInput, parseItemMeta, requiredInput } from "@/server/cart/meta";
import { resolveUnitPrice } from "@/server/cart/pricing";
import { MAX_LINE_QTY } from "@/server/cart/service";
import { validatePromo } from "./promo";
import { allocateDiscount, computeItemMoney, resolveCommissionBps } from "./pricing";
import { OutOfStockError, reserveStock } from "./stock";
import { releaseExpiredReservationsThrottled } from "./maintenance";
import { enqueueJob } from "@/server/worker";

/** Expected, user-facing checkout problem (Russian message). */
export class CheckoutError extends Error {
  constructor(
    message: string,
    public readonly code: "EMPTY_CART" | "UNAVAILABLE" | "OUT_OF_STOCK" | "INPUT_REQUIRED" | "PROMO" | "OWN_PRODUCT" | "INTERNAL" = "UNAVAILABLE",
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

export interface CreateOrderInput {
  userId: string;
  email: string;
  promoCode?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  /** chosen payment method, stored in Order.meta for analytics/debug */
  paymentMethod?: string | null;
}

export interface CreatedOrder {
  id: string;
  number: string;
  total: number;
  subtotal: number;
  discount: number;
}

/**
 * Create a PENDING order from the user's DB cart (CONTRACTS §6/§7/§9):
 *  - validates product/variant state and required buyer input
 *  - applies the promo (validated again inside the transaction), allocates the discount over lines
 *  - snapshots prices + commission (SellerProfile.commissionBps ?? Setting commission.defaultBps)
 *  - reserves AUTO_STOCK keys with FOR UPDATE SKIP LOCKED in the same transaction
 * The cart is NOT cleared here (done after the payment was initiated, see payments/initiate.ts).
 */
const cartItemInclude = {
  product: { include: { variants: { where: { isActive: true }, select: { id: true, price: true, attributes: true } }, seller: { select: { id: true, banned: true, sellerProfile: { select: { commissionBps: true, status: true } } } } } },
  variant: true,
} satisfies Prisma.CartItemInclude;

type CartItemRow = Prisma.CartItemGetPayload<{ include: typeof cartItemInclude }>;

/**
 * Lines an order is created from. Cart rows satisfy it as-is; zone F (REST API / MCP) builds the same shape from an
 * explicit item list with {@link loadOrderSourceItems}, so both entry points share ONE pricing/stock/commission path.
 */
export type OrderSourceItem = Pick<CartItemRow, "quantity" | "meta" | "variantId" | "product" | "variant">;

/** Loads products (+ variants, seller) for an explicit item list. Unknown product ids / variants throw CheckoutError. */
export async function loadOrderSourceItems(items: { productId: string; variantId?: string | null; quantity: number; meta?: Prisma.InputJsonValue | null }[]): Promise<OrderSourceItem[]> {
  const products = await prisma.product.findMany({ where: { id: { in: [...new Set(items.map((i) => i.productId))] } }, include: cartItemInclude.product.include });
  const byId = new Map(products.map((p) => [p.id, p]));
  const variantIds = [...new Set(items.flatMap((i) => (i.variantId ? [i.variantId] : [])))];
  const variants = variantIds.length ? await prisma.productVariant.findMany({ where: { id: { in: variantIds } } }) : [];
  const variantById = new Map(variants.map((v) => [v.id, v]));
  return items.map((i) => {
    const product = byId.get(i.productId);
    if (!product) throw new CheckoutError("Товар не найден", "UNAVAILABLE");
    const variant = i.variantId ? (variantById.get(i.variantId) ?? null) : null;
    if (i.variantId && (!variant || variant.productId !== product.id || !variant.isActive)) throw new CheckoutError(`«${product.title}»: вариант не найден или больше не продаётся`, "UNAVAILABLE");
    if (!i.variantId && product.variants.length > 0) throw new CheckoutError(`«${product.title}»: выберите вариант товара`, "UNAVAILABLE");
    return { quantity: i.quantity, meta: (i.meta ?? null) as OrderSourceItem["meta"], variantId: i.variantId ?? null, product, variant };
  });
}

export async function createOrderFromCart(input: CreateOrderInput): Promise<CreatedOrder> {
  const cart = await prisma.cart.findUnique({
    where: { userId: input.userId },
    include: { items: { orderBy: { createdAt: "asc" }, include: cartItemInclude } },
  });
  if (!cart || cart.items.length === 0) throw new CheckoutError("Корзина пуста", "EMPTY_CART");
  return createOrderFromItems(input, cart.items);
}

/** Creates the PENDING order from explicit lines (see {@link OrderSourceItem}); everything below is shared with the cart checkout. */
export async function createOrderFromItems(input: CreateOrderInput, sourceItems: OrderSourceItem[]): Promise<CreatedOrder> {
  await releaseExpiredReservationsThrottled();
  if (sourceItems.length === 0) throw new CheckoutError("Корзина пуста", "EMPTY_CART");

  const defaultBps = await getSetting<number>(SETTING_KEYS.commissionDefaultBps, env.commissionDefaultBps);
  const steamFee = sourceItems.some((i) => i.product.type === "TOPUP") ? await getSteamFeePercent() : undefined;

  // ── validate & price lines ──
  const lines = sourceItems.map((ci) => {
    const p = ci.product;
    if (p.status !== "ACTIVE" || p.seller.banned) throw new CheckoutError(`«${p.title}» больше не продаётся — удалите его из корзины`, "UNAVAILABLE");
    if (p.sellerId === input.userId) throw new CheckoutError("Нельзя купить собственный товар", "OWN_PRODUCT");
    if (ci.variant && (!ci.variant.isActive || ci.variant.productId !== p.id)) throw new CheckoutError(`«${p.title}»: вариант больше не продаётся`, "UNAVAILABLE");
    if (ci.quantity < 1 || ci.quantity > MAX_LINE_QTY) throw new CheckoutError(`«${p.title}»: некорректное количество`, "UNAVAILABLE");
    const req = requiredInput(p);
    if (!hasRequiredInput(req, ci.meta)) {
      throw new CheckoutError(req === "steamLogin" ? `«${p.title}»: укажите логин Steam` : `«${p.title}»: укажите данные для выдачи`, "INPUT_REQUIRED");
    }
    const parsedMeta = parseItemMeta(ci.meta);
    const meta = parsedMeta.ok ? parsedMeta.meta : null;
    // price is ALWAYS recomputed from the DB (variant price, or Steam wallet amount + service fee) — never from the client
    const priced = resolveUnitPrice(p, ci.variantId, meta, steamFee);
    if (!priced.ok) throw new CheckoutError(`«${p.title}»: ${priced.error}`, "UNAVAILABLE");
    if (priced.topupAmountKopecks && ci.quantity !== 1) throw new CheckoutError(`«${p.title}»: для пополнения произвольной суммы количество — 1`, "UNAVAILABLE");
    const unitPrice = priced.unitPrice;
    return {
      ci,
      product: p,
      variant: ci.variant,
      meta,
      unitPrice,
      gross: unitPrice * ci.quantity,
      bps: resolveCommissionBps(p.seller.sellerProfile?.commissionBps, defaultBps),
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.gross, 0);

  // ── promo (checked up-front for a friendly error; re-checked inside the tx to close races) ──
  let promoCodeId: string | null = null;
  let discount = 0;
  if (input.promoCode?.trim()) {
    const check = await validatePromo(input.promoCode, input.userId, subtotal, lines.length);
    if (!check.ok) throw new CheckoutError(check.error ?? "Промокод недействителен", "PROMO");
    promoCodeId = check.promoCodeId ?? null;
    discount = check.discount ?? 0;
  }

  const shares = allocateDiscount(lines.map((l) => l.gross), discount);
  const money = lines.map((l, i) => computeItemMoney(l.gross, shares[i]!, l.bps));
  const total = money.reduce((s, m) => s + m.total, 0);
  const appliedDiscount = shares.reduce((s, x) => s + x, 0);

  // ── persist in ONE transaction: order, items, stock reservation ──
  for (let attempt = 0; ; attempt++) {
    try {
      const order = await prisma.$transaction(
        async (tx) => {
          if (promoCodeId) {
            const recheck = await validatePromo(input.promoCode!, input.userId, subtotal, lines.length, tx);
            if (!recheck.ok) throw new CheckoutError(recheck.error ?? "Промокод недействителен", "PROMO");
          }
          const created = await tx.order.create({
            data: {
              number: generateOrderNumber(),
              buyerId: input.userId,
              email: input.email,
              status: "PENDING",
              subtotal,
              discount: appliedDiscount,
              total,
              promoCodeId,
              ip: input.ip ?? null,
              userAgent: input.userAgent?.slice(0, 300) ?? null,
              meta: { paymentMethod: input.paymentMethod ?? null, promoCode: input.promoCode?.trim().toUpperCase() || null },
            },
            select: { id: true, number: true },
          });
          for (let i = 0; i < lines.length; i++) {
            const l = lines[i]!;
            const m = money[i]!;
            const item = await tx.orderItem.create({
              data: {
                orderId: created.id,
                productId: l.product.id,
                variantId: l.variant?.id ?? null,
                sellerId: l.product.sellerId,
                title: l.product.title,
                variantTitle: l.variant?.title ?? null,
                unitPrice: l.unitPrice,
                quantity: l.ci.quantity,
                total: m.total,
                commissionBps: m.commissionBps,
                commissionAmount: m.commissionAmount,
                sellerEarning: m.sellerEarning,
                status: "PENDING",
                meta: l.meta ?? undefined,
              },
              select: { id: true },
            });
            if (l.product.deliveryMode === "AUTO_STOCK") {
              await reserveStock(tx, { productId: l.product.id, variantId: l.variant?.id ?? null, quantity: l.ci.quantity, orderItemId: item.id, productTitle: l.product.title });
            }
          }
          return created;
        },
        { timeout: 20_000, maxWait: 5_000 },
      );
      void enqueueJob("ai_score_fraud", { orderId: order.id });
      return { id: order.id, number: order.number, total, subtotal, discount: appliedDiscount };
    } catch (e) {
      if (e instanceof OutOfStockError) throw new CheckoutError(e.message, "OUT_OF_STOCK");
      // order number collision — retry with a fresh number
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt < 3) continue;
      throw e;
    }
  }
}
