import { prisma } from "@asap/db";
import { jsonOk } from "@/lib/api";
import { apiRoute } from "@/server/api-keys";

export const dynamic = "force-dynamic";

/** GET /api/v1/balance — site balance of the key owner, kopecks (fresh from the DB). */
export const GET = apiRoute({ scope: "orders:read" }, async ({ principal }) => {
  const u = await prisma.user.findUnique({ where: { id: principal.user.id }, select: { balance: true } });
  return jsonOk({ balance: u?.balance ?? 0, currency: "RUB" });
});
