/** Runtime configuration of the MCP server (env only; the API key is NEVER read from or written to disk/logs). */

export const SERVER_NAME = "asapawge-gg";
export const SERVER_VERSION = "1.0.0";

/** REST API base used for all calls: MCP_API_BASE_URL, else `${APP_URL}/api/v1`, else local dev. */
export function resolveApiBase(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.MCP_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const app = (env.APP_URL ?? env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").trim().replace(/\/+$/, "");
  return `${app}/api/v1`;
}

export function resolvePort(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.MCP_PORT ?? 3333);
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : 3333;
}
