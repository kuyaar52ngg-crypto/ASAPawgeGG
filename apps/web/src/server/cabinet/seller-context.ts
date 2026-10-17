import "server-only";
import { redirect } from "next/navigation";
import { prisma } from "@asap/db";
import { AuthError, assertRole, requireRole, type SessionUser } from "@/server/auth/session";

const profileSelect = {
  id: true,
  userId: true,
  shopName: true,
  slug: true,
  description: true,
  avatar: true,
  status: true,
  commissionBps: true,
  rating: true,
  ratingCount: true,
  salesCount: true,
  holdBalance: true,
  availableBalance: true,
  payoutDetails: true,
} as const;

export type SellerProfileView = NonNullable<Awaited<ReturnType<typeof loadProfile>>>;

function loadProfile(userId: string) {
  return prisma.sellerProfile.findUnique({ where: { userId }, select: profileSelect });
}

export interface SellerCtx {
  user: SessionUser;
  profile: SellerProfileView;
  /** may create/edit drafts, upload stock, deliver orders (PENDING and VERIFIED sellers) */
  canWrite: boolean;
  /** may submit products for moderation / get payouts (VERIFIED only) */
  verified: boolean;
}

function toCtx(user: SessionUser, profile: SellerProfileView): SellerCtx {
  return { user, profile, canWrite: profile.status === "PENDING" || profile.status === "VERIFIED", verified: profile.status === "VERIFIED" };
}

/**
 * Seller pages: role SELLER|ADMIN (redirects otherwise) + an existing SellerProfile.
 * An ADMIN without a seller profile has no seller cabinet and is sent to /admin.
 * Every seller page calls this itself — layouts are not re-run on client-side navigation.
 */
export async function requireSellerPage(): Promise<SellerCtx> {
  const user = await requireRole("SELLER", "ADMIN");
  const profile = await loadProfile(user.id);
  if (!profile) redirect(user.role === "ADMIN" ? "/admin" : "/account/become-seller");
  return toCtx(user, profile);
}

/** Seller server actions: throws AuthError (caught by `guarded`) for non-sellers or users without a profile. */
export async function assertSeller(opts: { write?: boolean; verified?: boolean } = {}): Promise<SellerCtx> {
  const user = await assertRole("SELLER", "ADMIN");
  const profile = await loadProfile(user.id);
  if (!profile) throw new AuthError("FORBIDDEN", "У вас нет профиля продавца");
  const ctx = toCtx(user, profile);
  if (opts.write && !ctx.canWrite) throw new AuthError("FORBIDDEN", "Профиль продавца заблокирован или отклонён");
  if (opts.verified && !ctx.verified) throw new AuthError("FORBIDDEN", "Действие доступно после подтверждения профиля администратором");
  return ctx;
}

/**
 * Seller context for a user authenticated by other means than the session cookie (zone F: API key / MCP).
 * Same rules as `assertSeller`: role SELLER|ADMIN and an existing SellerProfile; `write` / `verified` are enforced by the caller via the flags.
 */
export async function sellerCtxForUser(user: SessionUser): Promise<SellerCtx> {
  if (user.role !== "SELLER" && user.role !== "ADMIN") throw new AuthError("FORBIDDEN");
  const profile = await loadProfile(user.id);
  if (!profile) throw new AuthError("FORBIDDEN", "У вас нет профиля продавца");
  return toCtx(user, profile);
}
