"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { resolveSandboxPayment } from "@/server/payments/actions";

/** "Оплатить" / "Отклонить" — each sends a signed sandbox webhook through the real webhook pipeline. */
export function SandboxPanel({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [which, setWhich] = React.useState<"PAID" | "FAILED" | null>(null);

  function resolve(outcome: "PAID" | "FAILED") {
    setWhich(outcome);
    startTransition(async () => {
      const res = await resolveSandboxPayment({ paymentId, outcome });
      if (!res.ok) {
        toast.error(res.error);
        setWhich(null);
        return;
      }
      router.push(res.data.redirectUrl);
    });
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Button size="lg" variant="success" onClick={() => resolve("PAID")} loading={pending && which === "PAID"} disabled={pending}>
        <Check /> Оплатить
      </Button>
      <Button size="lg" variant="outline" onClick={() => resolve("FAILED")} loading={pending && which === "FAILED"} disabled={pending}>
        <X /> Отклонить
      </Button>
    </div>
  );
}
