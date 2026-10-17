import { DISPUTE_WINDOW_DAYS } from "@/components/cabinet/constants";

// Tiny clock helpers so pages/components stay free of direct Date.now() calls (react-hooks/purity).
export const daysAgo = (days: number): Date => new Date(Date.now() - days * 86_400_000);

/** True while a dispute can still be opened for something delivered at `deliveredAt` (unknown date => allowed). */
export function withinDisputeWindow(deliveredAt: Date | null | undefined): boolean {
  return !deliveredAt || Date.now() - deliveredAt.getTime() <= DISPUTE_WINDOW_DAYS * 86_400_000;
}
