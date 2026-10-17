import type { NextAuthConfig } from "next-auth";
import type { RoleName } from "@asap/shared";

/**
 * Edge-safe Auth.js config (no Prisma / argon2 imports) — shared by the proxy and the full config in auth.ts.
 * Session = JWT containing { id, role }. NOTE: role in the JWT can be stale (up to maxAge);
 * server code must use requireUser()/requireRole() (src/server/auth/session.ts) which re-read the DB.
 */
export const authConfig = {
  pages: { signIn: "/sign-in", error: "/sign-in" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 },
  trustHost: true,
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id as string;
        token.role = (user as { role: RoleName }).role;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = (token.role as RoleName) ?? "USER";
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
