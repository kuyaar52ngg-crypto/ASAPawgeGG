"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { createReviewAction } from "@/app/account/actions";
import { StarRating } from "./star-rating";

/** «Оставить отзыв» — one review per order item. Collapsed by default. */
export function ReviewForm({ orderItemId }: { orderItemId: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [rating, setRating] = React.useState(0);
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (rating < 1) return setError("Поставьте оценку от 1 до 5");
    setError(null);
    startTransition(async () => {
      const res = await createReviewAction({ orderItemId, rating, text: text.trim() || undefined });
      if (res.ok) {
        toast.success("Спасибо за отзыв!");
        router.refresh();
      } else setError(res.error);
    });
  }

  if (!open) {
    return <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}><Star /> Оставить отзыв</Button>;
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-border bg-foreground/[0.03] p-4">
      <Field label="Ваша оценка"><StarRating value={rating} onChange={setRating} disabled={pending} /></Field>
      <Field label="Комментарий" htmlFor={`review-${orderItemId}`} hint="Необязательно, до 2000 символов">
        <Textarea id={`review-${orderItemId}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Как всё прошло: скорость выдачи, ключ сработал, общение с продавцом…" />
      </Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={pending}>Отправить отзыв</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Отмена</Button>
      </div>
    </form>
  );
}
