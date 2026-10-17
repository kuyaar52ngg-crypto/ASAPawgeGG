import "server-only";
import { prisma, type Prisma } from "@asap/db";
import type { AnalyticsEventName } from "@asap/shared";

/**
 * Record a server-side analytics event (AnalyticsEvent table). Never throws.
 * Event names: see docs/CONTRACTS.md "Analytics events" / ANALYTICS_EVENTS in @asap/shared.
 * Zone D owns this folder and may extend it, but keep this signature stable.
 */
export async function trackEvent(e: {
  name: AnalyticsEventName;
  userId?: string | null;
  sessionId?: string | null;
  path?: string;
  referrer?: string;
  properties?: Prisma.InputJsonValue;
  userAgent?: string;
}): Promise<void> {
  try {
    await prisma.analyticsEvent.create({ data: { ...e } });
  } catch (err) {
    console.warn("[analytics] trackEvent failed:", (err as Error).message);
  }
}
