"use client";
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";

/** Delivered keys / credentials with one-click copy. Rendered only for the buyer of the order. */
export function SecretList({ secrets }: { secrets: string[] }) {
  const [copied, setCopied] = React.useState<number | null>(null);
  async function copy(i: number) {
    try {
      await navigator.clipboard.writeText(secrets[i]!);
      setCopied(i);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      toast.error("Не удалось скопировать — выделите текст вручную");
    }
  }
  return (
    <ul className="space-y-2">
      {secrets.map((s, i) => (
        <li key={i} className="flex items-center gap-2 rounded-xl border border-border bg-foreground/[0.04] p-2 pl-3.5">
          <code className="min-w-0 flex-1 text-sm break-all select-all">{s}</code>
          <Button type="button" size="icon-sm" variant="ghost" onClick={() => copy(i)} aria-label="Скопировать">
            {copied === i ? <Check className="text-success" /> : <Copy />}
          </Button>
        </li>
      ))}
    </ul>
  );
}
