"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/ui/sonner";

/** Minimal structural type of the server-action envelope (kept client-safe; no server imports). */
export type AnyActionResult = { ok: true; data?: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

/** Run a server action, toast the outcome and refresh the RSC tree on success. */
export function useRunAction() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<AnyActionResult>, opts: { success?: string; onDone?: (data: unknown) => void; onError?: (r: Extract<AnyActionResult, { ok: false }>) => void } = {}) =>
    start(async () => {
      try {
        const r = await fn();
        if (r.ok) {
          toast.success(opts.success ?? "Готово");
          opts.onDone?.(r.data);
          router.refresh();
        } else {
          toast.error(r.error);
          opts.onError?.(r);
        }
      } catch {
        toast.error("Не удалось выполнить действие. Попробуйте ещё раз.");
      }
    });
  return { run, pending };
}
