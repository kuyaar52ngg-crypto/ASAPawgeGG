"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { FileUp, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { deleteStockAction, uploadStockAction } from "@/app/seller/actions";
import { formatDateTime } from "./labels";
import { parseCsvFirstColumn } from "./csv";
import { SelectField } from "./select-field";

const MAX_BATCH = 5000;

const splitLines = (text: string) => text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

export interface VariantOption {
  id: string;
  title: string;
}

export function StockUploader({ productId, variants }: { productId: string; variants: VariantOption[] }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [variantId, setVariantId] = React.useState(variants[0]?.id ?? "");
  const [fileInfo, setFileInfo] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const fileRef = React.useRef<HTMLInputElement>(null);

  const lines = React.useMemo(() => splitLines(text), [text]);
  const unique = React.useMemo(() => new Set(lines).size, [lines]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 2_000_000) return toast.error("Файл слишком большой (максимум 2 МБ)");
    const raw = await file.text();
    const keys = /\.csv$/i.test(file.name) ? parseCsvFirstColumn(raw) : splitLines(raw);
    setText((prev) => [prev.trim(), ...keys].filter(Boolean).join("\n"));
    setFileInfo(`${file.name}: прочитано строк — ${keys.length}`);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSummary(null);
    if (lines.length === 0) return setError("Вставьте ключи или загрузите файл");
    if (lines.length > MAX_BATCH) return setError(`За один раз можно загрузить до ${MAX_BATCH} ключей — разделите список`);
    startTransition(async () => {
      const res = await uploadStockAction({ productId, variantId: variants.length ? variantId : null, items: lines });
      if (res.ok) {
        const d = res.data;
        const parts = [`Добавлено: ${d.added}`];
        if (d.duplicatesInBatch + d.duplicatesExisting > 0) parts.push(`дубликатов пропущено: ${d.duplicatesInBatch + d.duplicatesExisting}`);
        if (d.rejected > 0) parts.push(`отклонено (пустые/слишком длинные): ${d.rejected}`);
        setSummary(parts.join(" · "));
        toast.success(d.added > 0 ? `Загружено ключей: ${d.added}` : "Новых ключей не добавлено");
        setText("");
        setFileInfo(null);
        router.refresh();
      } else setError(res.fieldErrors?.variantId?.[0] ?? res.error);
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {variants.length > 0 && (
        <Field label="Вариант товара" hint="Ключи привязываются к выбранному варианту">
          <SelectField label="Вариант товара" value={variantId} onChange={setVariantId} options={variants.map((v) => ({ value: v.id, label: v.title }))} placeholder="Выберите вариант" />
        </Field>
      )}
      <Field label="Ключи" htmlFor="stock-text" hint={`По одному в строке (ключ, login:password, ссылка). До ${MAX_BATCH} за раз. Дубликаты отбрасываются автоматически.`}>
        <Textarea id="stock-text" value={text} onChange={(e) => setText(e.target.value)} className="min-h-44 font-mono text-xs" placeholder={"AAAAA-BBBBB-CCCCC\nDDDDD-EEEEE-FFFFF"} spellCheck={false} autoComplete="off" />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={onFile} aria-label="Файл с ключами" />
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><FileUp /> Загрузить CSV / TXT</Button>
        <Button type="submit" loading={pending} disabled={lines.length === 0}><Upload /> Добавить на склад{lines.length ? ` (${unique})` : ""}</Button>
        {lines.length > 0 && <span className="text-xs text-muted-foreground">Строк: {lines.length}{unique !== lines.length ? `, уникальных: ${unique}` : ""}</span>}
      </div>
      {fileInfo && <p className="text-xs text-muted-foreground">{fileInfo}</p>}
      {summary && <p className="rounded-xl bg-success/10 px-3 py-2 text-sm text-success">{summary}</p>}
      {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
    </form>
  );
}

export interface UnsoldRowView {
  id: string;
  masked: string;
  variantTitle: string | null;
  createdAt: string;
}

/** Unsold (AVAILABLE) keys with masked previews; delete selected or all. Sold/reserved keys are never listed or deletable. */
export function UnsoldTable({ productId, rows, total }: { productId: string; rows: UnsoldRowView[]; total: number }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [pending, startTransition] = React.useTransition();
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  function run(label: string, input: Parameters<typeof deleteStockAction>[0], confirmText: string) {
    if (!window.confirm(confirmText)) return;
    startTransition(async () => {
      const res = await deleteStockAction(input);
      if (res.ok) {
        toast.success(`${label}: ${res.data.deleted}`);
        setSelected(new Set());
        router.refresh();
      } else toast.error(res.error);
    });
  }

  if (total === 0) return <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">Нераспроданных ключей нет.</p>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" disabled={selected.size === 0 || pending} onClick={() => run("Удалено", { productId, ids: [...selected] }, `Удалить выбранные ключи (${selected.size})? Это действие необратимо.`)}><Trash2 /> Удалить выбранные{selected.size ? ` (${selected.size})` : ""}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => run("Удалено", { productId, all: true }, `Удалить ВСЕ нераспроданные ключи (${total})? Проданные и зарезервированные останутся.`)}>Удалить все нераспроданные</Button>
        <span className="ml-auto text-xs text-muted-foreground">Всего нераспроданных: {total}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-foreground/[0.04] text-left text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-3 py-2"><Checkbox checked={allOnPage} onCheckedChange={(v) => setSelected(v === true ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Выбрать все на странице" /></th>
              <th className="px-3 py-2 font-medium">Ключ</th>
              <th className="hidden px-3 py-2 font-medium sm:table-cell">Вариант</th>
              <th className="px-3 py-2 text-right font-medium">Добавлен</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2"><Checkbox checked={selected.has(r.id)} onCheckedChange={(v) => toggle(r.id, v === true)} aria-label="Выбрать" /></td>
                <td className="px-3 py-2 font-mono text-xs">{r.masked}</td>
                <td className="hidden px-3 py-2 text-muted-foreground sm:table-cell">{r.variantTitle ?? "—"}</td>
                <td className="px-3 py-2 text-right text-xs text-muted-foreground">{formatDateTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
