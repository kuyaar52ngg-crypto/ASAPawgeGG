"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { openDisputeAction } from "@/app/account/actions";

/** «Открыть спор» — creates a Dispute with a chat thread (buyer + seller, admin joins on escalation). */
export function DisputeDialog({ orderItemId, itemTitle }: { orderItemId: string; itemTitle: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await openDisputeAction({ orderItemId, reason });
      if (res.ok) {
        toast.success("Спор открыт. Продавец получил уведомление.");
        setOpen(false);
        router.push(`/account/disputes/${res.data.disputeId}`);
      } else setError(res.fieldErrors?.reason?.[0] ?? res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline"><MessageSquareWarning /> Открыть спор</Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Открыть спор</DialogTitle>
            <DialogDescription>«{itemTitle}». Опишите, что пошло не так: ключ не подошёл, товар не соответствует описанию и т. п.</DialogDescription>
          </DialogHeader>
          <Field label="Суть проблемы" htmlFor="dispute-reason" hint="Минимум 10 символов">
            <Textarea id="dispute-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} required minLength={10} className="min-h-32" />
          </Field>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Отмена</Button>
            <Button type="submit" loading={pending}>Открыть спор</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
