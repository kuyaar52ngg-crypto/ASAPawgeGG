"use server";
import { AuthError as AuthJsError } from "next-auth";
import { prisma } from "@asap/db";
import { signInSchema, signUpSchema, slugify } from "@asap/shared";
import { signIn } from "@/auth";
import { hashPassword } from "@/server/auth/password";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request";
import { trackEvent } from "@/server/analytics/track";
import { mergeGuestCartForEmail, mergeGuestCartForUser } from "@/server/cart/context";

export interface AuthFormState {
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
}

/** Only allow same-site relative redirects. */
function safeRedirect(url: FormDataEntryValue | null, fallback = "/account"): string {
  const s = typeof url === "string" ? url : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : fallback;
}

export async function signInAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signInSchema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Введите корректный email и пароль" };
  try {
    await signIn("credentials", { ...parsed.data, redirectTo: safeRedirect(formData.get("callbackUrl"), "/") });
  } catch (e) {
    if (e instanceof AuthJsError) return { error: "Неверный email или пароль, либо слишком много попыток входа" };
    // successful login => Auth.js throws NEXT_REDIRECT: merge the guest cart (cookie) into the user's cart first
    if ((e as { digest?: string }).digest?.startsWith("NEXT_REDIRECT")) await mergeGuestCartForEmail(parsed.data.email);
    throw e; // NEXT_REDIRECT
  }
  return {};
}

export async function signUpAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    asSeller: formData.get("asSeller") === "on" || formData.get("asSeller") === "1",
  });
  if (!parsed.success) return { error: "Проверьте введённые данные", fieldErrors: parsed.error.flatten().fieldErrors };

  const ip = await getClientIp();
  const rl = await rateLimit({ key: `signup:${ip}`, limit: 10, windowSec: 3600 });
  if (!rl.ok) return { error: "Слишком много регистраций с вашего адреса. Попробуйте позже." };

  const { name, email, password, asSeller } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (exists) return { error: "Пользователь с таким email уже зарегистрирован", fieldErrors: { email: ["Email уже занят"] } };

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      name,
      passwordHash,
      role: asSeller ? "SELLER" : "USER",
      ...(asSeller
        ? { sellerProfile: { create: { shopName: name, slug: `${slugify(name) || "shop"}-${Math.random().toString(36).slice(2, 6)}`, status: "PENDING" } } }
        : {}),
    },
  });
  void trackEvent({ name: "sign_up", userId: user.id, properties: { role: user.role } });
  await mergeGuestCartForUser(user.id);

  try {
    await signIn("credentials", { email, password, redirectTo: safeRedirect(formData.get("callbackUrl"), asSeller ? "/seller" : "/account") });
  } catch (e) {
    if (e instanceof AuthJsError) return { error: "Аккаунт создан, но войти не удалось. Попробуйте войти вручную." };
    throw e;
  }
  return {};
}
