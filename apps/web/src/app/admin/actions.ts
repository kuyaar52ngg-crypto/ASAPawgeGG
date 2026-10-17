"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { adminAction, ok, parseInput } from "@/server/admin/action";
import { invalidateDashboardCache } from "@/server/analytics/metrics";
import { summarizeMetrics } from "@/server/analytics/summary";

export interface AiSummaryData {
  text: string;
  provider: string;
  model: string;
  mock: boolean;
  generatedAt: string;
}

/** «AI-сводка»: LLM summary of the dashboard metrics (rule-based fallback when no provider is configured). */
export async function aiSummaryAction(input: { days: number }) {
  return adminAction<AiSummaryData>(async ({ admin }) => {
    const p = parseInput(z.object({ days: z.union([z.literal(7), z.literal(30), z.literal(90)]) }), input);
    if (p.error) return p.error;
    const r = await summarizeMetrics(p.data.days, admin.id);
    return ok({ text: r.text, provider: r.provider, model: r.model, mock: r.mock, generatedAt: new Date().toISOString() });
  });
}

/** «Обновить»: drop the 5-minute Redis cache of the dashboard. */
export async function refreshMetricsAction() {
  return adminAction(async () => {
    await invalidateDashboardCache();
    revalidatePath("/admin");
    revalidatePath("/admin/analytics");
    return ok();
  });
}
