import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

const globalForPrisma = globalThis as unknown as { __asapPrisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL ?? "postgresql://asap:asap@localhost:5432/asapawge";
  const adapter = new PrismaPg({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 10) });
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

/** Singleton Prisma client (survives Next.js dev HMR). */
export const prisma: PrismaClient = globalForPrisma.__asapPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__asapPrisma = prisma;
