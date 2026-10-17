import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import type { RoleName } from "@asap/shared";
import { authConfig } from "./auth.config";

/**
 * Next 16 "proxy" (formerly middleware). Coarse, JWT-based route guard:
 *   /account/*  any signed-in user
 *   /seller/*   SELLER or ADMIN
 *   /admin/*    ADMIN
 *   /checkout/* any signed-in user
 * The JWT role may be stale — pages and server actions MUST still call requireUser()/requireRole().
 */
const { auth } = NextAuth(authConfig);

const RULES: { prefix: string; roles?: RoleName[] }[] = [
  { prefix: "/admin", roles: ["ADMIN"] },
  { prefix: "/seller", roles: ["SELLER", "ADMIN"] },
  { prefix: "/account" },
  { prefix: "/checkout" },
];

export default auth((req) => {
  const { pathname, search } = req.nextUrl;
  const rule = RULES.find((r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"));
  if (!rule) return NextResponse.next();

  const user = req.auth?.user;
  if (!user) {
    const url = new URL("/sign-in", req.nextUrl.origin);
    url.searchParams.set("callbackUrl", pathname + search);
    return NextResponse.redirect(url);
  }
  if (rule.roles && !rule.roles.includes(user.role)) {
    return NextResponse.redirect(new URL("/forbidden", req.nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ["/admin/:path*", "/seller/:path*", "/account/:path*", "/checkout/:path*"],
};
