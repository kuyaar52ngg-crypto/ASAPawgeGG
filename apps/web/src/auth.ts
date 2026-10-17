import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@asap/db";
import { signInSchema } from "@asap/shared";
import { authConfig } from "./auth.config";
import { burnPasswordCheck, verifyPassword } from "./server/auth/password";
import { rateLimit } from "./lib/rate-limit";
import { ipFromRequest } from "./lib/request";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  // Adapter is only used for OAuth account linking (future); sessions are JWT.
  adapter: PrismaAdapter(prisma as never),
  providers: [
    Credentials({
      name: "Email",
      credentials: { email: {}, password: {} },
      async authorize(raw, request) {
        const parsed = signInSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        const ip = ipFromRequest(request);
        const [byIp, byEmail] = await Promise.all([
          rateLimit({ key: `login:ip:${ip}`, limit: 30, windowSec: 900 }),
          rateLimit({ key: `login:email:${email}`, limit: 10, windowSec: 900 }),
        ]);
        if (!byIp.ok || !byEmail.ok) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user?.passwordHash) {
          await burnPasswordCheck(password);
          return null;
        }
        if (user.banned) return null;
        if (!(await verifyPassword(user.passwordHash, password))) return null;

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }).catch(() => {});
        return { id: user.id, email: user.email, name: user.name, image: user.image, role: user.role };
      },
    }),
  ],
});
