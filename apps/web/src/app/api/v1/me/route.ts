import { jsonOk } from "@/lib/api";
import { apiRoute } from "@/server/api-keys";

export const dynamic = "force-dynamic";

/** GET /api/v1/me — who the key belongs to, its effective role and scopes (MCP uses it to decide which tools to expose). */
export const GET = apiRoute({ scope: null }, async ({ principal }) =>
  jsonOk({ userId: principal.user.id, name: principal.user.name, role: principal.role, scopes: principal.scopes, keyPrefix: principal.keyPrefix }),
);
