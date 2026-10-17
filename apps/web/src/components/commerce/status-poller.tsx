"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { pollOrderStatus, pollTopupStatus } from "@/server/payments/actions";

/**
 * Polls the server (which also reconciles with the gateway / runs the fulfilment fallback) until the
 * order or top-up reaches a final state, then refreshes the page. Gives up after ~4 minutes.
 */
export function StatusPoller({ kind, id, message }: { kind: "order" | "topup"; id: string; message: string }) {
  const router = useRouter();
  React.useEffect(() => {
    let stopped = false;
    let tries = 0;
    const tick = async () => {
      if (stopped) return;
      tries++;
      try {
        if (kind === "order") {
          const r = await pollOrderStatus(id);
          if (r.ok && (r.data.done || r.data.stage !== "pending")) {
            router.refresh();
            if (r.data.done) return;
          }
        } else {
          const r = await pollTopupStatus(id);
          if (r.ok && r.data.stage !== "pending") {
            router.refresh();
            return;
          }
        }
      } catch {
        /* network blip — retry */
      }
      if (tries < 80) setTimeout(tick, tries < 10 ? 2500 : 4000);
    };
    const t = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      clearTimeout(t);
    };
  }, [kind, id, router]);

  return (
    <p className="flex items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="size-4 animate-spin" /> {message}
    </p>
  );
}
