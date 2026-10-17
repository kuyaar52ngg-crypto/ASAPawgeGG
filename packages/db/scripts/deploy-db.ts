/**
 * Build-time DB step for hosted deployments (e.g. Vercel):
 *   1. `prisma migrate deploy` (uses DIRECT_URL → DATABASE_URL, see prisma.config.ts)
 *   2. seeds demo data ONLY when SEED_ON_BUILD=1 AND the database has no users yet
 *      (the seed wipes all tables, so it must never run against a live database).
 * Skipped entirely when no database URL is configured.
 */
import { execSync } from "node:child_process";
import path from "node:path";

const dbDir = path.resolve(import.meta.dirname, "..");
const run = (cmd: string) => execSync(cmd, { cwd: dbDir, stdio: "inherit", env: process.env });

if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
  console.log("[deploy-db] no DIRECT_URL/DATABASE_URL — skipping migrations");
  process.exit(0);
}

run("pnpm exec prisma migrate deploy");

if (process.env.SEED_ON_BUILD === "1") {
  const { prisma } = await import("../src/client");
  const users = await prisma.user.count();
  await prisma.$disconnect();
  if (users === 0) {
    console.log("[deploy-db] empty database + SEED_ON_BUILD=1 — seeding demo data");
    run("pnpm exec tsx prisma/seed.ts");
  } else {
    console.log(`[deploy-db] database already has ${users} users — seed skipped`);
  }
}
