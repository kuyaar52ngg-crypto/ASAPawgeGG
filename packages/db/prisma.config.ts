import path from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Load monorepo-root .env (Prisma 7 does not load .env automatically)
loadEnv({ path: path.resolve(__dirname, "../../.env"), quiet: true });

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  migrations: {
    path: path.join("prisma", "migrations"),
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://asap:asap@localhost:5432/asapawge",
  },
});
