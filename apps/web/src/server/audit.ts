import "server-only";
import { prisma, type Prisma } from "@asap/db";

/** Write an admin/security audit record. Call from every privileged server action. */
export async function writeAudit(entry: {
  actorId?: string | null;
  action: string; // e.g. "product.approve", "user.ban", "payout.paid"
  entityType: string;
  entityId?: string | null;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string;
}) {
  await prisma.auditLog.create({ data: { ...entry } });
}
