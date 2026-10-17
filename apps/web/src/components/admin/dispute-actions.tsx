"use client";
import * as React from "react";
import { Send, Sparkles, Undo2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ActionDialog, useFieldError } from "./action-dialog";
import { FieldRow } from "./fields";
import { useRunAction } from "./use-run-action";
import { generateDisputeAdviceAction, postDisputeMessageAction, resolveDisputeAction } from "@/app/admin/disputes/actions";

export function DisputeChatForm({ disputeId }: { disputeId: string }) {
  const { run, pending } = useRunAction();
  const ref = React.useRef<HTMLTextAreaElement>(null);
  return (
    <form
      className="grid gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const body = ref.current?.value.trim() ?? "";
        if (!body) return;
        run(() => postDisputeMessageAction({ disputeId, body }), { success: "Сообщение отправлено", onDone: () => { if (ref.current) ref.current.value = ""; } });
      }}
    >
      <Textarea ref={ref} name="body" placeholder="Сообщение сторонам спора (видят покупатель и продавец)…" maxLength={4000} />
      <div><Button type="submit" size="sm" loading={pending}>{!pending && <Send />} Отправить</Button></div>
    </form>
  );
}

export function AiAdviceButton({ disputeId, hasAdvice }: { disputeId: string; hasAdvice: boolean }) {
  const { run, pending } = useRunAction();
  return (
    <Button variant="outline" size="sm" loading={pending} onClick={() => run(() => generateDisputeAdviceAction({ disputeId }), { success: "Совет AI обновлён" })}>
      {!pending && <Sparkles />} {hasAdvice ? "Обновить совет AI" : "Запросить совет AI"}
    </Button>
  );
}

function ResolutionField({ placeholder }: { placeholder: string }) {
  const error = useFieldError("resolution");
  return (
    <FieldRow label="Обоснование решения (увидят обе стороны)" error={error}>
      <Textarea name="resolution" required minLength={5} maxLength={1000} placeholder={placeholder} />
    </FieldRow>
  );
}

export function ResolveButtons({ disputeId, amountLabel }: { disputeId: string; amountLabel: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionDialog trigger="Вернуть деньги покупателю" triggerSize="default" triggerVariant="destructive" triggerIcon={<Undo2 />} title="Решение: возврат" description={`Сумма возврата: ${amountLabel} — на баланс покупателя через леджер. Спор будет закрыт.`} submitLabel="Вернуть деньги" submitVariant="destructive" success="Спор решён: возврат оформлен" action={(v) => resolveDisputeAction({ disputeId, decision: "refund", resolution: v.resolution })}>
        <ResolutionField placeholder="Например: товар не был активирован по вине продавца" />
      </ActionDialog>
      <ActionDialog trigger="Отклонить спор" triggerSize="default" triggerVariant="outline" triggerIcon={<XCircle />} title="Решение: отклонить претензию" description="Деньги остаются у продавца, заказ возвращается в статус «Выдан»." submitLabel="Отклонить спор" success="Спор отклонён" action={(v) => resolveDisputeAction({ disputeId, decision: "reject", resolution: v.resolution })}>
        <ResolutionField placeholder="Например: выдача подтверждена, ключ активирован" />
      </ActionDialog>
    </div>
  );
}

