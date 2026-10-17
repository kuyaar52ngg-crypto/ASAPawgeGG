import "server-only";
import { Prisma, prisma } from "@asap/db";
import { randomUUID } from "node:crypto";
import { getSteamFeePercent } from "@/server/catalog/steam";
import { hasRequiredInput, metaKey, parseItemMeta, requiredInput, type ItemMeta, type RequiredInput } from "./meta";
import { resolveUnitPrice } from "./pricing";

export const MAX_LINE_QTY = 50;
export const MAX_CART_LINES = 30;

/** Who owns a cart: a signed-in user or a guest identified by the `asap_cart` cookie token. */
export type CartOwner = { userId: string } | { guestToken: string };

export interface CartLine {
  id: string;
  productId: string;
  variantId: string | null;
  slug: string;
  title: string;
  variantTitle: string | null;
  image: string | null;
  platform: string | null;
  region: string | null;
  type: string;
  deliveryMode: string;
  sellerId: string;
  unitPrice: number;
  oldPrice: number | null;
  quantity: number;
  lineTotal: number;
  meta: ItemMeta | null;
  /** custom Steam top-up: kopecks credited to the wallet (price already includes the service fee) */
  topupAmount: number | null;
  /** buyer input this line still needs (steam login / note) */
  requiredInput: RequiredInput;
  /** units a buyer can still add: stock for AUTO_STOCK, else MAX_LINE_QTY */
  maxQty: number;
  /** null when the line can be ordered, else a Russian reason */
  problem: string | null;
}

export interface CartView {
  cartId: string | null;
  lines: CartLine[];
  count: number;
  subtotal: number;
  /** false when any line has a problem or lacks required input */
  checkoutReady: boolean;
}

export type CartResult<T = undefined> = ({ ok: true } & (T extends undefined ? object : { data: T })) | { ok: false; error: string };

const ownerWhere = (o: CartOwner) => ("userId" in o ? { userId: o.userId } : { guestToken: o.guestToken });

export function newGuestToken(): string {
  return randomUUID();
}

async function findCart(owner: CartOwner) {
  return prisma.cart.findFirst({ where: ownerWhere(owner), select: { id: true } });
}

/** Cart row for the owner (created on demand). Tolerates the unique-violation race of two concurrent first adds. */
async function ensureCart(owner: CartOwner): Promise<string> {
  const existing = await findCart(owner);
  if (existing) return existing.id;
  try {
    const created = await prisma.cart.create({ data: "userId" in owner ? { userId: owner.userId } : { guestToken: owner.guestToken }, select: { id: true } });
    return created.id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const again = await findCart(owner);
      if (again) return again.id;
    }
    throw e;
  }
}

/** Number of AVAILABLE stock items for a product/variant. */
export async function availableStock(productId: string, variantId: string | null): Promise<number> {
  return prisma.stockItem.count({ where: { productId, variantId, status: "AVAILABLE" } });
}

// ───────────────────────── read ─────────────────────────

export async function getCartView(owner: CartOwner | null): Promise<CartView> {
  const empty: CartView = { cartId: null, lines: [], count: 0, subtotal: 0, checkoutReady: false };
  if (!owner) return empty;
  const cart = await prisma.cart.findFirst({
    where: ownerWhere(owner),
    select: {
      id: true,
      items: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          productId: true,
          variantId: true,
          quantity: true,
          meta: true,
          product: {
            select: {
              slug: true, title: true, coverImage: true, platform: true, region: true, type: true, deliveryMode: true,
              status: true, price: true, oldPrice: true, sellerId: true,
              variants: { where: { isActive: true }, select: { id: true, price: true, attributes: true } },
            },
          },
          variant: { select: { id: true, title: true, price: true, oldPrice: true, isActive: true, productId: true } },
        },
      },
    },
  });
  if (!cart) return empty;

  // stock per (product, variant) for AUTO_STOCK lines in one query
  const stockProducts = [...new Set(cart.items.filter((i) => i.product.deliveryMode === "AUTO_STOCK").map((i) => i.productId))];
  const stockRows = stockProducts.length
    ? await prisma.stockItem.groupBy({ by: ["productId", "variantId"], where: { productId: { in: stockProducts }, status: "AVAILABLE" }, _count: { _all: true } })
    : [];
  const stock = new Map(stockRows.map((r) => [`${r.productId}:${r.variantId ?? ""}`, r._count._all]));

  const steamFee = cart.items.some((i) => i.product.type === "TOPUP") ? await getSteamFeePercent() : undefined;

  const lines: CartLine[] = cart.items.map((i) => {
    const p = i.product;
    const v = i.variant;
    const req = requiredInput(p);
    const parsedMeta = parseItemMeta(i.meta);
    const meta = parsedMeta.ok ? parsedMeta.meta : null;
    const priced = resolveUnitPrice(p, i.variantId, meta, steamFee);
    const unitPrice = priced.ok ? priced.unitPrice : (v?.price ?? p.price);
    const oldPrice = priced.ok && priced.topupAmountKopecks ? null : v ? v.oldPrice : p.oldPrice;
    const avail = p.deliveryMode === "AUTO_STOCK" ? (stock.get(`${i.productId}:${i.variantId ?? ""}`) ?? 0) : MAX_LINE_QTY;
    let problem: string | null = null;
    if (p.status !== "ACTIVE") problem = "Товар снят с продажи";
    else if (!priced.ok) problem = priced.error;
    else if (v && (!v.isActive || v.productId !== i.productId)) problem = "Этот вариант больше не продаётся";
    else if (avail <= 0) problem = "Нет в наличии";
    else if (i.quantity > avail) problem = `Доступно только ${avail} шт.`;
    return {
      id: i.id,
      productId: i.productId,
      variantId: i.variantId,
      slug: p.slug,
      title: p.title,
      variantTitle: v?.title ?? null,
      image: p.coverImage,
      platform: p.platform,
      region: p.region,
      type: p.type,
      deliveryMode: p.deliveryMode,
      sellerId: p.sellerId,
      unitPrice,
      oldPrice,
      quantity: i.quantity,
      lineTotal: unitPrice * i.quantity,
      meta,
      topupAmount: priced.ok ? (priced.topupAmountKopecks ?? null) : null,
      requiredInput: req,
      maxQty: Math.min(MAX_LINE_QTY, Math.max(avail, 0)),
      problem,
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  return {
    cartId: cart.id,
    lines,
    count: lines.reduce((s, l) => s + l.quantity, 0),
    subtotal,
    checkoutReady: lines.length > 0 && lines.every((l) => !l.problem && hasRequiredInput(l.requiredInput, l.meta)),
  };
}

// ───────────────────────── write ─────────────────────────

export interface AddItemInput {
  productId: string;
  variantId?: string | null;
  quantity: number;
  meta?: unknown;
}

export async function addItem(owner: CartOwner, input: AddItemInput): Promise<CartResult<{ itemId: string; quantity: number; unitPrice: number }>> {
  const product = await prisma.product.findUnique({
    where: { id: input.productId },
    select: {
      id: true, status: true, type: true, deliveryMode: true, platform: true, title: true, price: true, sellerId: true,
      variants: { where: { isActive: true }, select: { id: true, price: true, attributes: true } },
    },
  });
  if (!product || product.status !== "ACTIVE") return { ok: false, error: "Товар недоступен" };
  if ("userId" in owner && product.sellerId === owner.userId) return { ok: false, error: "Нельзя купить собственный товар" };

  const parsedMeta = parseItemMeta(input.meta);
  if (!parsedMeta.ok) return { ok: false, error: parsedMeta.error };
  const meta = parsedMeta.meta;

  const priced = resolveUnitPrice(product, product.variants.length > 0 ? (input.variantId ?? null) : null, meta, product.type === "TOPUP" ? await getSteamFeePercent() : undefined);
  if (!priced.ok) return { ok: false, error: priced.error };
  const variantId = priced.variantId;
  const quantity = priced.topupAmountKopecks ? 1 : input.quantity; // a custom wallet amount is always a single line item

  const cartId = await ensureCart(owner);
  const existing = await prisma.cartItem.findMany({ where: { cartId }, select: { id: true, productId: true, variantId: true, quantity: true, meta: true } });
  const sameLine = existing.find((e) => e.productId === product.id && e.variantId === variantId && metaKey(e.meta) === metaKey(meta));
  if (!sameLine && existing.length >= MAX_CART_LINES) return { ok: false, error: `В корзине не может быть больше ${MAX_CART_LINES} позиций` };

  const wanted = priced.topupAmountKopecks ? 1 : (sameLine?.quantity ?? 0) + quantity;
  if (wanted > MAX_LINE_QTY) return { ok: false, error: `Максимум ${MAX_LINE_QTY} шт. одной позиции` };
  if (product.deliveryMode === "AUTO_STOCK") {
    // stock is shared by all cart lines of the same product+variant
    const inOtherLines = existing.filter((e) => e.productId === product.id && e.variantId === variantId && e.id !== sameLine?.id).reduce((s, e) => s + e.quantity, 0);
    const avail = await availableStock(product.id, variantId);
    if (avail <= 0) return { ok: false, error: "Нет в наличии" };
    if (wanted + inOtherLines > avail) return { ok: false, error: `В наличии только ${avail} шт.` };
  }

  const unitPrice = priced.unitPrice;
  if (sameLine) {
    const updated = await prisma.cartItem.update({ where: { id: sameLine.id }, data: { quantity: wanted }, select: { id: true } });
    return { ok: true, data: { itemId: updated.id, quantity: wanted, unitPrice } };
  }
  const created = await prisma.cartItem.create({
    data: { cartId, productId: product.id, variantId, quantity, meta: meta ?? undefined },
    select: { id: true },
  });
  return { ok: true, data: { itemId: created.id, quantity, unitPrice } };
}

/** Loads an item only if it belongs to the owner's cart (ownership check). */
async function ownedItem(owner: CartOwner, itemId: string) {
  return prisma.cartItem.findFirst({
    where: { id: itemId, cart: ownerWhere(owner) },
    select: { id: true, cartId: true, productId: true, variantId: true, quantity: true, meta: true, product: { select: { deliveryMode: true } } },
  });
}

export async function setQuantity(owner: CartOwner, itemId: string, quantity: number): Promise<CartResult<{ quantity: number }>> {
  const item = await ownedItem(owner, itemId);
  if (!item) return { ok: false, error: "Позиция не найдена" };
  if (quantity <= 0) {
    await prisma.cartItem.delete({ where: { id: item.id } });
    return { ok: true, data: { quantity: 0 } };
  }
  if (quantity > MAX_LINE_QTY) return { ok: false, error: `Максимум ${MAX_LINE_QTY} шт.` };
  const m = parseItemMeta(item.meta);
  if (m.ok && m.meta?.amountKopecks && quantity > 1) return { ok: false, error: "Для пополнения произвольной суммы количество — 1" };
  if (item.product.deliveryMode === "AUTO_STOCK") {
    const others = await prisma.cartItem.aggregate({
      _sum: { quantity: true },
      where: { cartId: item.cartId, productId: item.productId, variantId: item.variantId, id: { not: item.id } },
    });
    const avail = await availableStock(item.productId, item.variantId);
    if (quantity + (others._sum.quantity ?? 0) > avail) return { ok: false, error: avail > 0 ? `В наличии только ${avail} шт.` : "Нет в наличии" };
  }
  await prisma.cartItem.update({ where: { id: item.id }, data: { quantity } });
  return { ok: true, data: { quantity } };
}

export async function removeItem(owner: CartOwner, itemId: string): Promise<CartResult<{ productId: string; variantId: string | null; quantity: number }>> {
  const item = await ownedItem(owner, itemId);
  if (!item) return { ok: false, error: "Позиция не найдена" };
  await prisma.cartItem.delete({ where: { id: item.id } });
  return { ok: true, data: { productId: item.productId, variantId: item.variantId, quantity: item.quantity } };
}

/** Set the buyer's delivery input (Steam login / note) on a line. */
export async function setItemMeta(owner: CartOwner, itemId: string, rawMeta: unknown): Promise<CartResult> {
  const item = await ownedItem(owner, itemId);
  if (!item) return { ok: false, error: "Позиция не найдена" };
  const parsed = parseItemMeta(rawMeta);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  await prisma.cartItem.update({ where: { id: item.id }, data: { meta: parsed.meta ?? Prisma.DbNull } });
  return { ok: true };
}

export async function clearCart(owner: CartOwner): Promise<void> {
  const cart = await findCart(owner);
  if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
}

/**
 * Merge a guest cart into the user's cart (on sign-in / sign-up). Same line (product+variant+meta) => quantities add (capped);
 * other lines move over. The guest cart row is deleted. Idempotent: a missing guest cart is a no-op.
 * Returns the number of merged lines.
 */
export async function mergeGuestCart(userId: string, guestToken: string): Promise<number> {
  if (!guestToken) return 0;
  return prisma.$transaction(async (tx) => {
    const guest = await tx.cart.findUnique({ where: { guestToken }, include: { items: true } });
    if (!guest) return 0;
    let userCart = await tx.cart.findUnique({ where: { userId }, include: { items: true } });
    if (!userCart) userCart = await tx.cart.create({ data: { userId }, include: { items: true } });
    let merged = 0;
    for (const gi of guest.items) {
      // never let a seller buy their own product via merge
      const product = await tx.product.findUnique({ where: { id: gi.productId }, select: { sellerId: true } });
      if (!product || product.sellerId === userId) continue;
      const match = userCart.items.find((u) => u.productId === gi.productId && u.variantId === gi.variantId && metaKey(u.meta) === metaKey(gi.meta));
      if (match) {
        await tx.cartItem.update({ where: { id: match.id }, data: { quantity: Math.min(MAX_LINE_QTY, match.quantity + gi.quantity) } });
      } else if (userCart.items.length + merged < MAX_CART_LINES) {
        await tx.cartItem.create({ data: { cartId: userCart.id, productId: gi.productId, variantId: gi.variantId, quantity: gi.quantity, meta: gi.meta ?? undefined } });
      }
      merged++;
    }
    await tx.cart.delete({ where: { id: guest.id } });
    return merged;
  });
}
