"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import { API_SCOPES } from "@asap/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { createApiKeyAction, revokeApiKeyAction } from "@/app/account/actions";
import type { ApiKeyRow } from "@/server/cabinet/api-keys";
import { formatDate, formatDateTime } from "./labels";

const SCOPE_LABELS: Record<(typeof API_SCOPES)[number], string> = {
  "catalog:read": "Каталог: чтение",
  "orders:read": "Заказы: чтение",
  "orders:create": "Заказы: создание",
  "seller:products": "Продавец: товары",
  "seller:stock": "Продавец: склад ключей",
  "seller:stats": "Продавец: статистика",
  "admin:metrics": "Админ: метрики",
  "admin:moderate": "Админ: модерация",
};

const EXPIRY = [
  { value: "0", label: "Бессрочный" },
  { value: "30", label: "30 дней" },
  { value: "90", label: "90 дней" },
  { value: "365", label: "1 год" },
];

export function ApiKeysManager({ keys, allowedScopes, maxActive }: { keys: ApiKeyRow[]; allowedScopes: string[]; maxActive: number }) {
  const router = useRouter();
  const [name, setName] = React.useState("");
  const [scopes, setScopes] = React.useState<string[]>(allowedScopes.slice(0, 1));
  const [expiry, setExpiry] = React.useState("0");
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [revoking, setRevoking] = React.useState<string | null>(null);

  const isActive = (k: ApiKeyRow) => k.state === "active";
  const activeCount = keys.filter(isActive).length;

  function toggle(scope: string, on: boolean) {
    setScopes((s) => (on ? [...new Set([...s, scope])] : s.filter((x) => x !== scope)));
  }

  function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (scopes.length === 0) return setError("Выберите хотя бы одно право доступа");
    startTransition(async () => {
      const res = await createApiKeyAction({ name, scopes, expiresInDays: expiry === "0" ? undefined : Number(expiry) });
      if (res.ok) {
        setCreated(res.data.key);
        setName("");
        router.refresh();
      } else setError(res.fieldErrors?.name?.[0] ?? res.error);
    });
  }

  async function copyKey() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Не удалось скопировать — выделите ключ вручную");
    }
  }

  async function revoke(id: string) {
    if (!window.confirm("Отозвать ключ? Приложения, которые его используют, перестанут работать.")) return;
    setRevoking(id);
    const res = await revokeApiKeyAction(id);
    setRevoking(null);
    if (res.ok) {
      toast.success("Ключ отозван");
      router.refresh();
    } else toast.error(res.error);
  }

  return (
    <div className="space-y-8">
      <form onSubmit={create} className="glass space-y-5 rounded-2xl p-5 sm:p-6">
        <div>
          <h2 className="font-display text-lg font-semibold">Новый ключ</h2>
          <p className="text-sm text-muted-foreground">Ключ используется для REST API (<code>/api/v1</code>) и MCP-сервера. Активных ключей: {activeCount} из {maxActive}.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <Field label="Название" htmlFor="key-name" hint="Например: «Мой бот» или «Claude Desktop»">
            <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} placeholder="Мой бот" />
          </Field>
          <Field label="Срок действия" htmlFor="key-exp">
            <select id="key-exp" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="h-11 w-full rounded-xl border border-input bg-foreground/[0.04] px-3 text-sm outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30">
              {EXPIRY.map((o) => <option key={o.value} value={o.value} className="bg-popover">{o.label}</option>)}
            </select>
          </Field>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Права доступа</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {allowedScopes.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border px-3 py-2 text-sm hover:border-primary/40">
                <Checkbox checked={scopes.includes(s)} onCheckedChange={(v) => toggle(s, v === true)} />
                <span className="min-w-0"><span className="block">{SCOPE_LABELS[s as keyof typeof SCOPE_LABELS] ?? s}</span><code className="text-[11px] text-muted-foreground">{s}</code></span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <Button type="submit" loading={pending} disabled={activeCount >= maxActive}><Plus /> Создать ключ</Button>
      </form>

      <section>
        <h2 className="mb-3 font-display text-lg font-semibold">Ваши ключи</h2>
        {keys.length === 0 ? (
          <p className="glass rounded-2xl px-5 py-8 text-center text-sm text-muted-foreground">Ключей пока нет.</p>
        ) : (
          <ul className="space-y-3">
            {keys.map((k) => {
              const active = isActive(k);
              return (
                <li key={k.id} className="glass flex flex-wrap items-center gap-3 rounded-2xl p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary"><KeyRound className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {k.name}
                      {k.state === "revoked" ? <Badge variant="secondary">Отозван</Badge> : k.state === "expired" ? <Badge variant="warning">Истёк</Badge> : <Badge variant="success">Активен</Badge>}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{k.prefix}…</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Создан {formatDate(k.createdAt)} · {k.lastUsedAt ? `использован ${formatDateTime(k.lastUsedAt)}` : "ещё не использовался"}
                      {k.expiresAt && ` · действует до ${formatDate(k.expiresAt)}`}
                    </p>
                    <p className="mt-2 flex flex-wrap gap-1.5">{k.scopes.map((s) => <Badge key={s} variant="outline" className="font-mono text-[11px] font-normal">{s}</Badge>)}</p>
                  </div>
                  {active && (
                    <Button type="button" size="sm" variant="outline" loading={revoking === k.id} onClick={() => revoke(k.id)}><Trash2 /> Отозвать</Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <Dialog open={!!created} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ключ создан</DialogTitle>
            <DialogDescription>Скопируйте ключ сейчас — после закрытия окна он больше не будет показан.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2 rounded-xl border border-border bg-foreground/[0.04] p-2 pl-3.5">
            <code className="min-w-0 flex-1 text-sm break-all select-all">{created}</code>
            <Button type="button" size="icon-sm" variant="ghost" onClick={copyKey} aria-label="Скопировать">{copied ? <Check className="text-success" /> : <Copy />}</Button>
          </div>
          <p className="flex items-start gap-2 text-xs text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" /> Храните ключ как пароль: он даёт доступ к вашему аккаунту в рамках выбранных прав.</p>
          <DialogFooter><Button type="button" onClick={() => setCreated(null)}>Я сохранил ключ</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
