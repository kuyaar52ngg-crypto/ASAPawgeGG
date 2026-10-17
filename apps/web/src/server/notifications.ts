import "server-only";
import { prisma, type NotificationType, type Prisma } from "@asap/db";

/** Create an in-app notification for a user. */
export async function notify(userId: string, n: { type?: NotificationType; title: string; body?: string; link?: string; data?: Prisma.InputJsonValue }) {
  return prisma.notification.create({ data: { userId, type: n.type ?? "SYSTEM", title: n.title, body: n.body, link: n.link, data: n.data } });
}
