"use client";
import * as React from "react";
import { gsap, prefersReducedMotion, ScrollTrigger, useGSAP } from "@/lib/gsap";

export interface StatItem {
  value: number;
  label: string;
  suffix?: string;
  decimals?: number;
  hint?: string;
}

const fmt = (n: number, d: number) => new Intl.NumberFormat("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);

/** Trust stats. Server-rendered with the final numbers; counts up from 0 when scrolled into view (GSAP). */
export function StatsCounters({ items }: { items: StatItem[] }) {
  const ref = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReducedMotion()) return;
      el.querySelectorAll<HTMLElement>("[data-count]").forEach((node) => {
        const target = Number(node.dataset.count);
        const dec = Number(node.dataset.dec ?? 0);
        const suffix = node.dataset.suffix ?? "";
        const state = { v: 0 };
        node.textContent = fmt(0, dec) + suffix;
        gsap.to(state, {
          v: target,
          duration: 1.8,
          ease: "power2.out",
          onUpdate: () => (node.textContent = fmt(state.v, dec) + suffix),
          scrollTrigger: { trigger: node, start: "top 92%", once: true },
        });
      });
      ScrollTrigger.refresh();
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
      {items.map((s) => (
        <div key={s.label} className="glass rounded-2xl p-4 text-center sm:p-5">
          <p className="gradient-brand-text font-display text-2xl font-bold sm:text-3xl" data-count={s.value} data-dec={s.decimals ?? 0} data-suffix={s.suffix ?? ""}>
            {fmt(s.value, s.decimals ?? 0)}
            {s.suffix}
          </p>
          <p className="mt-1.5 text-sm font-medium">{s.label}</p>
          {s.hint && <p className="mt-0.5 text-xs text-muted-foreground">{s.hint}</p>}
        </div>
      ))}
    </div>
  );
}
