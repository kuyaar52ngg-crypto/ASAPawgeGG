"use client";
import { Archive, Check, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { ActionDialog, useFieldError } from "./action-dialog";
import { FieldRow } from "./fields";
import { useRunAction } from "./use-run-action";
import { moderateProductAction, rerunAiModerationAction } from "@/app/admin/products/actions";

export function ProductModerationActions({ productId, title, status, compact }: { productId: string; title: string; status: string; compact?: boolean }) {
  const size = compact ? "sm" : "default";
  return (
    <div className="flex flex-wrap gap-2">
      {status !== "ACTIVE" && (
        <ActionDialog trigger="Одобрить" triggerVariant="success" triggerSize={size} triggerIcon={<Check />} title={`Опубликовать «${title}»?`} description="Товар станет доступен в каталоге, продавец получит уведомление." submitLabel="Опубликовать" submitVariant="success" success="Товар опубликован" action={() => moderateProductAction({ productId, decision: "approve" })} />
      )}
      {(status === "PENDING_REVIEW" || status === "ACTIVE") && (
        <ActionDialog trigger="Отклонить" triggerVariant="destructive" triggerSize={size} triggerIcon={<X />} title={`Отклонить «${title}»`} description="Причину увидит продавец — опишите, что нужно исправить." submitLabel="Отклонить" submitVariant="destructive" success="Товар отклонён" action={(v) => moderateProductAction({ productId, decision: "reject", reason: v.reason })}>
          <ReasonField />
        </ActionDialog>
      )}
      {status === "ACTIVE" && (
        <ActionDialog trigger="В архив" triggerVariant="outline" triggerSize={size} triggerIcon={<Archive />} title={`Снять «${title}» с продажи?`} submitLabel="В архив" success="Товар в архиве" action={() => moderateProductAction({ productId, decision: "archive" })} />
      )}
    </div>
  );
}

function ReasonField() {
  const error = useFieldError("reason");
  return (
    <FieldRow label="Причина отклонения" error={error}>
      <Textarea name="reason" required maxLength={500} placeholder="Например: описание не соответствует товару, укажите платформу и регион активации" />
    </FieldRow>
  );
}

export function RerunAiButton({ productId }: { productId: string }) {
  const { run, pending } = useRunAction();
  return (
    <Button variant="outline" size="sm" loading={pending} onClick={() => run(() => rerunAiModerationAction({ productId }), { success: "AI-проверка запущена" })}>
      {!pending && <Sparkles />} Перепроверить AI
    </Button>
  );
}
