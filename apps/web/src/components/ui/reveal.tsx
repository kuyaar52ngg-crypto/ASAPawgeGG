"use client";
import * as React from "react";
import { gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";
import { cn } from "@/lib/utils";

/**
 * Scroll-reveal wrapper (GSAP ScrollTrigger). Children fade/slide in when scrolled into view.
 * `stagger` animates direct children one after another instead of the wrapper itself.
 * Respects prefers-reduced-motion.
 */
export function Reveal({
  children,
  className,
  y = 28,
  delay = 0,
  duration = 0.7,
  stagger,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  y?: number;
  delay?: number;
  duration?: number;
  stagger?: number;
  as?: React.ElementType;
}) {
  const ref = React.useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const targets = stagger ? Array.from(el.children) : el;
      if (prefersReducedMotion()) {
        gsap.set(targets, { opacity: 1, y: 0 });
        gsap.set(el, { opacity: 1 });
        return;
      }
      gsap.set(el, { opacity: 1 });
      gsap.fromTo(
        targets,
        { opacity: 0, y },
        { opacity: 1, y: 0, duration, delay, stagger: stagger ?? 0, ease: "power3.out", scrollTrigger: { trigger: el, start: "top 88%", once: true } },
      );
    },
    { scope: ref },
  );

  return (
    <Tag ref={ref} data-reveal className={cn(className)}>
      {children}
    </Tag>
  );
}
