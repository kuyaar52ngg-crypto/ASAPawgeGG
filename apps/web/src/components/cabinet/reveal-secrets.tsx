"use client";
import * as React from "react";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { SecretList } from "@/components/commerce/secret-list";
import { revealItemSecretsAction } from "@/app/account/actions";

/**
 * Delivered keys / credentials. Plaintext is NOT in the page: it is decrypted on the server only when the owner
 * presses «Показать» (revealItemSecretsAction re-checks ownership).
 */
export function RevealSecrets({ orderItemId, count }: { orderItemId: string; count: number }) {
  const [secrets, setSecrets] = React.useState<string[] | null>(null);
  const [pending, startTransition] = React.useTransition();

  function reveal() {
    startTransition(async () => {
      const res = await revealItemSecretsAction(orderItemId);
      if (res.ok) setSecrets(res.data.secrets);
      else toast.error(res.error);
    });
  }

  if (!secrets) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-border p-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/12 text-primary"><KeyRound className="size-[18px]" /></span>
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium">{count > 0 ? `Выдано ключей: ${count}` : "Данные для активации готовы"}</p>
          <p className="text-xs text-muted-foreground">Ключи скрыты — нажмите «Показать», чтобы увидеть и скопировать.</p>
        </div>
        <Button type="button" size="sm" onClick={reveal} loading={pending}><Eye /> Показать</Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {secrets.length > 0 ? <SecretList secrets={secrets} /> : <p className="text-sm text-muted-foreground">Ключей для отображения нет — смотрите сообщение продавца ниже.</p>}
      <Button type="button" size="sm" variant="ghost" onClick={() => setSecrets(null)}><EyeOff /> Скрыть</Button>
    </div>
  );
}
