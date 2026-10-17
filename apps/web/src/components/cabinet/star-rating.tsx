"use client";
import * as React from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

/** Interactive 1–5 star picker. */
export function StarRating({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const [hover, setHover] = React.useState(0);
  const shown = hover || value;
  return (
    <div className="inline-flex gap-1" role="radiogroup" aria-label="Оценка" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={`${n} из 5`}
          disabled={disabled}
          onMouseEnter={() => setHover(n)}
          onClick={() => onChange(n)}
          className="cursor-pointer rounded-md p-0.5 transition-transform hover:scale-110 disabled:cursor-not-allowed"
        >
          <Star className={cn("size-7 transition-colors", n <= shown ? "fill-warning text-warning" : "text-muted-foreground/50")} />
        </button>
      ))}
    </div>
  );
}
