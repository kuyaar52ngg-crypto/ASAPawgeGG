"use client";
import { Button } from "@/components/ui/button";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="container-page flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-2xl font-bold">Что-то пошло не так</h1>
      <p className="max-w-md text-muted-foreground">Мы уже знаем о проблеме. Попробуйте обновить страницу.</p>
      {error.digest && <code className="text-xs text-muted-foreground">код: {error.digest}</code>}
      <Button onClick={reset}>Попробовать снова</Button>
    </main>
  );
}
