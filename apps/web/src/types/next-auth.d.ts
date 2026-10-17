import type { DefaultSession } from "next-auth";
import type { RoleName } from "@asap/shared";

declare module "next-auth" {
  interface Session {
    user: { id: string; role: RoleName } & DefaultSession["user"];
  }
  interface User {
    role: RoleName;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: RoleName;
  }
}
