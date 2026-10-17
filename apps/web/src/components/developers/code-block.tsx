"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Monospace snippet with a copy button (clipboard access is best effort). */
export function CodeBlock({ code, lang, className }: { code: string; lang?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={cn("group relative overflow-hidden rounded-xl border border-border bg-background/60", className)}>
      {lang && <span className="absolute left-3 top-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{lang}</span>}
      <button
        type="button"
        aria-label="Скопировать"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked */
          }
        }}
        className="absolute right-2 top-2 grid size-8 place-items-center rounded-lg border border-border bg-card/80 text-muted-foreground opacity-0 transition hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
      </button>
      <pre className={cn("no-scrollbar overflow-x-auto p-4 text-[13px] leading-relaxed", lang && "pt-7")}>
        <code>{code}</code>
      </pre>
    </div>
  );
}
