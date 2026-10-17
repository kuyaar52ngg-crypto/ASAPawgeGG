import "server-only";
import { z } from "zod";
import { prisma } from "@asap/db";
import { passwordSchema, slugify } from "@asap/shared";
import { rateLimit } from "@/lib/rate-limit";
import { writeAudit } from "@/server/audit";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import type { SessionUser } from "@/server/auth/session";
import { notify } from "@/server/notifications";
import { fail, ok, zodFail, type ActionResult } from "./result";

const profileSchema = z.object({ name: z.string().trim().min(2, "Минимум 2 символа").max(60, "Максимум 60 символов") });

export async function updateProfile(user: Pick<SessionUser, "id">, raw: unknown): Promise<ActionResult> {
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  await prisma.user.update({ where: { id: user.id }, data: { name: parsed.data.name } });
  return ok();
}

const passwordChangeSchema = z
  .object({ current: z.string().min(1, "Введите текущий пароль").max(128), next: passwordSchema, confirm: z.string().max(128) })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Пароли не совпадают" })
  .refine((v) => v.next !== v.current, { path: ["next"], message: "Новый пароль должен отличаться от текущего" });

export async function changePassword(user: Pick<SessionUser, "id">, raw: unknown): Promise<ActionResult> {
  const parsed = passwordChangeSchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const rl = await rateLimit({ key: `pwd-change:${user.id}`, limit: 5, windowSec: 900 });
  if (!rl.ok) return fail("Слишком много попыток. Попробуйте через 15 минут.");
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (!row?.passwordHash) return fail("Для этого аккаунта пароль не задан");
  if (!(await verifyPassword(row.passwordHash, parsed.data.current))) return fail("Текущий пароль указан неверно", { current: ["Неверный пароль"] });
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(parsed.data.next) } });
  await writeAudit({ actorId: user.id, action: "user.password_change", entityType: "User", entityId: user.id }).catch(() => {});
  return ok();
}

const applySchema = z.object({
  shopName: z.string().trim().min(3, "Название магазина — минимум 3 символа").max(60, "Максимум 60 символов"),
  description: z.string().trim().min(20, "Расскажите о себе и товарах подробнее (минимум 20 символов)").max(1000),
});

/** USER applies to become a seller -> SellerProfile(status PENDING). Admin approval (zone D) flips status to VERIFIED and role to SELLER. */
export async function applyForSeller(user: Pick<SessionUser, "id" | "role" | "email">, raw: unknown): Promise<ActionResult> {
  if (user.role !== "USER") return fail(user.role === "SELLER" ? "Вы уже зарегистрированы как продавец" : "Администратору заявка не требуется");
  const parsed = applySchema.safeParse(raw);
  if (!parsed.success) return zodFail(parsed.error);
  const rl = await rateLimit({ key: `seller-apply:${user.id}`, limit: 5, windowSec: 3600 });
  if (!rl.ok) return fail("Слишком много попыток. Попробуйте позже.");

  const existing = await prisma.sellerProfile.findUnique({ where: { userId: user.id }, select: { id: true, status: true } });
  if (existing && existing.status !== "REJECTED") {
    return fail(existing.status === "PENDING" ? "Заявка уже отправлена и находится на рассмотрении" : existing.status === "SUSPENDED" ? "Профиль продавца приостановлен — обратитесь в поддержку" : "Профиль продавца уже подтверждён");
  }
  if (existing) {
    await prisma.sellerProfile.update({ where: { id: existing.id }, data: { shopName: parsed.data.shopName, description: parsed.data.description, status: "PENDING" } });
  } else {
    const base = slugify(parsed.data.shopName) || "shop";
    let slug = base;
    for (let i = 0; i < 6 && (await prisma.sellerProfile.findUnique({ where: { slug }, select: { id: true } })); i++) slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    await prisma.sellerProfile.create({ data: { userId: user.id, shopName: parsed.data.shopName, slug, description: parsed.data.description, status: "PENDING" } });
  }
  await writeAudit({ actorId: user.id, action: "seller.apply", entityType: "SellerProfile", entityId: user.id, after: { shopName: parsed.data.shopName } }).catch(() => {});
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", banned: false }, select: { id: true }, take: 20 });
  await Promise.all(admins.map((a) => notify(a.id, { type: "SYSTEM", title: "Новая заявка продавца", body: `${parsed.data.shopName} (${user.email})`, link: "/admin/users" }).catch(() => {})));
  return ok();
}
