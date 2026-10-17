import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Load monorepo-root .env when present (Prisma 7 does not load .env automatically; absent on CI / Vercel — real env vars are used)
loadEnv({ path: path.resolve(__dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Migrations need a session-capable connection: DIRECT_URL (Supabase direct :5432 / session pooler) when set,
    // otherwise DATABASE_URL. `prisma generate` never connects, so the local fallback is only a placeholder.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "postgresql://asap:asap@localhost:5432/asapawge",
  },
});
