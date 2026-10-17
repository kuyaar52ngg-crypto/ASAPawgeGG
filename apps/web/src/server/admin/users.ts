import "server-only";
import { z } from "zod";
import { prisma } from "@asap/db";
import { ROLES, formatRub, idSchema, rubToKopecks, slugify } from "@asap/shared";
import { AdminError, audit, fail, ok, parseInput, type AdminCtx } from "./action";
import { postLedger } from "@/server/ledger/ledger";
import type { LedgerLine } from "@/server/ledger/accounts";
import { notify } from "@/server/notifications";

const MAX_ADJUST_KOPECKS = 100_000_000; // 1 000 000 ₽ per adjustment

async function uniqueSellerSlug(base: string): Promise<string> {
  const root = slugify(base) || "shop";
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    if (!(await prisma.sellerProfile.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Change a user's role. Admins cannot change their own role; at least one other ADMIN must remain when demoting an admin. */
export async function setUserRole(ctx: AdminCtx, input: unknown) {
  const p = parseInput(z.object({ userId: idSchema, role: z.enum(ROLES) }), input);
  if (p.error) return p.error;
  const { userId, role } = p.data;
  if (userId === ctx.admin.id) return fail("Нельзя изменить собственную роль");

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, name: true, email: true, sellerProfile: { select: { id: true, status: true } } } });
    if (!user) throw new AdminError("Пользователь не найден");
    if (user.role === role) throw new AdminError("У пользователя уже эта роль");
    if (user.role === "ADMIN" && (await tx.user.count({ where: { role: "ADMIN", banned: false, id: { not: userId } } })) === 0) throw new AdminError("Нельзя оставить площадку без администратора");

    await tx.user.update({ where: { id: userId }, data: { role } });
    if (role === "SELLER" && !user.sellerProfile) {
      const shopName = (user.name ?? user.email.split("@")[0] ?? "Магазин").slice(0, 60);
      await tx.sellerProfile.create({ data: { userId, shopName, slug: await uniqueSellerSlug(shopName), status: "VERIFIED", verifiedAt: new Date() } });
    }
    if (role === "USER" && user.sellerProfile && user.sellerProfile.status === "VERIFIED") {
      await tx.sellerProfile.update({ where: { id: user.sellerProfile.id }, data: { status: "SUSPENDED" } });
    }
    await audit(tx, ctx, { action: "user.role", entityType: "User", entityId: userId, before: { role: user.role }, after: { role } });
  });
  return ok();
}

/** Ban / unban. Banning revokes the user's API keys; banned users are rejected by every session helper. */
export async function setUserBan(ctx: AdminCtx, input: unknown) {
  const p = parseInput(z.object({ userId: idSchema, banned: z.boolean(), reason: z.string().trim().max(300).optional() }), input);
  if (p.error) return p.error;
  const { userId, banned, reason } = p.data;
  if (userId === ctx.admin.id) return fail("Нельзя заблокировать самого себя");
  if (banned && !reason) return fail("Укажите причину блокировки", { reason: ["Укажите причину"] });

  const target = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, banned: true, bannedReason: true } });
    if (!user) throw new AdminError("Пользователь не найден");
    if (banned && user.role === "ADMIN") throw new AdminError("Администратора нужно сначала сделать обычным пользователем");
    if (user.banned === banned) throw new AdminError(banned ? "Пользователь уже заблокирован" : "Пользователь не заблокирован");
    await tx.user.update({ where: { id: userId }, data: { banned, bannedReason: banned ? reason : null } });
    if (banned) await tx.apiKey.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(tx, ctx, { action: banned ? "user.ban" : "user.unban", entityType: "User", entityId: userId, before: { banned: user.banned, reason: user.bannedReason }, after: { banned, reason: banned ? reason : null } });
    return user;
  });
  if (!banned) await notify(target.id, { type: "SYSTEM", title: "Аккаунт разблокирован", body: "Доступ к площадке восстановлен." }).catch(() => {});
  return ok();
}

const adjustSchema = z.object({
  userId: idSchema,
  direction: z.enum(["credit", "debit"]),
  amount: z.string().trim().regex(/^\d{1,7}([.,]\d{1,2})?$/, "Введите сумму в рублях, например 500 или 99,50"),
  source: z.enum(["EXTERNAL", "PLATFORM_FEE"]).default("EXTERNAL"),
  memo: z.string().trim().min(3, "Укажите комментарий (минимум 3 символа)").max(200),
});

/**
 * Manual balance adjustment: a balanced ADJUSTMENT posting in the ledger (CONTRACTS §8) + audit + notification.
 *   credit: DEBIT <source> · CREDIT USER_BALANCE      debit: DEBIT USER_BALANCE · CREDIT <source>
 * `source` = EXTERNAL (money moved outside the platform, e.g. manual bank top-up) or PLATFORM_FEE (bonus / compensation paid by the platform).
 */
export async function adjustUserBalance(ctx: AdminCtx, input: unknown) {
  const p = parseInput(adjustSchema, input);
  if (p.error) return p.error;
  const { userId, direction, source, memo } = p.data;
  const amount = rubToKopecks(p.data.amount);
  if (amount <= 0) return fail("Сумма должна быть больше нуля", { amount: ["Сумма должна быть больше нуля"] });
  if (amount > MAX_ADJUST_KOPECKS) return fail("Слишком большая сумма для ручной корректировки", { amount: ["Максимум 1 000 000 ₽"] });

  let after = 0;
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, balance: true } });
      if (!user) throw new AdminError("Пользователь не найден");
      const lines: LedgerLine[] =
        direction === "credit"
          ? [
              { account: source, direction: "DEBIT", amount },
              { account: "USER_BALANCE", ownerId: userId, direction: "CREDIT", amount },
            ]
          : [
              { account: "USER_BALANCE", ownerId: userId, direction: "DEBIT", amount },
              { account: source, direction: "CREDIT", amount },
            ];
      await postLedger(tx, { kind: "ADJUSTMENT", lines, memo: `Корректировка администратором: ${memo}` });
      const fresh = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { balance: true } });
      after = fresh.balance;
      await audit(tx, ctx, {
        action: "user.balance_adjust",
        entityType: "User",
        entityId: userId,
        before: { balance: user.balance },
        after: { balance: fresh.balance, direction, amount, source, memo },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.name === "InsufficientFundsError") return fail("Недостаточно средств на балансе пользователя для списания");
    throw e;
  }
  await notify(userId, {
    type: "SYSTEM",
    title: direction === "credit" ? "Баланс пополнен администратором" : "Списание с баланса администратором",
    body: `${direction === "credit" ? "+" : "−"}${formatRub(amount)}. ${memo}`,
    link: "/account/balance",
  }).catch(() => {});
  return ok({ balance: after });
}
