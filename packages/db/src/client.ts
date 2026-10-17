import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client";

const globalForPrisma = globalThis as unknown as { __asapPrisma?: PrismaClient };

/**
 * Pool settings for the pg driver behind @prisma/adapter-pg.
 *  - Serverless (Vercel): every lambda instance keeps its own pool, so keep it tiny (3) and let idle sockets go;
 *    DATABASE_URL is expected to be a transaction pooler (Supabase :6543). The driver issues only unnamed statements
 *    (no `name:` / statementNameGenerator), the only session state we rely on is inside interactive transactions
 *    (SELECT … FOR UPDATE), so transaction pooling is fine. DATABASE_POOL_MAX overrides.
 *  - Supabase presents a certificate chain that Node does not trust by default; `sslmode=require` in the URL would be
 *    upgraded to verify-full by pg, so for *.supabase.com / *.supabase.co we encrypt without chain verification
 *    (set DATABASE_SSL_STRICT=1 to keep pg's verification).
 */
function poolConfig(rawUrl: string) {
  const onVercel = Boolean(process.env.VERCEL);
  const max = Number(process.env.DATABASE_POOL_MAX) || (onVercel ? 3 : 10);
  const base = { max, ...(onVercel ? { idleTimeoutMillis: 10_000, connectionTimeoutMillis: 10_000 } : {}) };
  try {
    const url = new URL(rawUrl);
    const supabase = /\.supabase\.(com|co)$/.test(url.hostname);
    const mode = url.searchParams.get("sslmode");
    if (supabase && mode !== "disable" && process.env.DATABASE_SSL_STRICT !== "1") {
      url.searchParams.delete("sslmode");
      return { ...base, connectionString: url.toString(), ssl: { rejectUnauthorized: false } };
    }
  } catch {
    /* not a URL: let pg report it */
  }
  return { ...base, connectionString: rawUrl };
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL || "postgresql://asap:asap@localhost:5432/asapawge";
  const adapter = new PrismaPg(poolConfig(connectionString));
  return new PrismaClient({
    adapter,
    log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["warn", "error"],
  });
}

/** Singleton Prisma client (survives Next.js dev HMR). */
export const prisma: PrismaClient = globalForPrisma.__asapPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__asapPrisma = prisma;
