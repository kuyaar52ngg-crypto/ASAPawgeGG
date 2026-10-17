"use client";
import * as React from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { discountPercent, formatRub } from "@asap/shared/money";
import { PLATFORMS } from "@asap/shared/constants";
import { gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface HeroSlideData {
  id: string;
  slug: string;
  title: string;
  blurb: string | null;
  image: string | null;
  price: number;
  oldPrice: number | null;
  platform: string | null;
  hasVariants: boolean;
  categoryName: string;
}

const AUTOPLAY_SEC = 6.5;

/**
 * Featured products hero. GSAP timeline per slide change (content stagger, image zoom), mouse parallax with the glow orbs,
 * autoplay with a progress bar (pauses on hover / focus / hidden tab). Respects prefers-reduced-motion (no autoplay, no tweens).
 */
export function HeroCarousel({ slides }: { slides: HeroSlideData[] }) {
  const root = React.useRef<HTMLDivElement>(null);
  const [active, setActive] = React.useState(0);
  const activeRef = React.useRef(0);
  const first = React.useRef(true);
  const paused = React.useRef(false);
  const progressTween = React.useRef<gsap.core.Tween | null>(null);
  const count = slides.length;

  const go = React.useCallback(
    (to: number) => {
      setActive(((to % count) + count) % count);
    },
    [count],
  );

  // Slide transition + autoplay timer
  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const reduce = prefersReducedMotion();
      const all = gsap.utils.toArray<HTMLElement>("[data-slide]", el);
      const incoming = all[active];
      const prevIndex = activeRef.current;
      const outgoing = all[prevIndex];
      activeRef.current = active;

      if (reduce) {
        all.forEach((s, i) => gsap.set(s, { autoAlpha: i === active ? 1 : 0 }));
        return;
      }

      if (first.current) {
        first.current = false;
        gsap.fromTo(incoming!.querySelectorAll("[data-anim]"), { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8, stagger: 0.09, ease: "power3.out", delay: 0.1 });
        gsap.fromTo(incoming!.querySelector("[data-art]"), { scale: 0.88, autoAlpha: 0, rotate: -3 }, { scale: 1, autoAlpha: 1, rotate: 0, duration: 1, ease: "power3.out" });
      } else if (incoming && outgoing && incoming !== outgoing) {
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
        tl.to(outgoing.querySelectorAll("[data-anim]"), { x: -40, autoAlpha: 0, duration: 0.35, stagger: 0.03 }, 0)
          .to(outgoing.querySelector("[data-art]"), { scale: 0.9, autoAlpha: 0, duration: 0.4 }, 0)
          .set(outgoing, { autoAlpha: 0 })
          .set(incoming, { autoAlpha: 1 })
          .fromTo(incoming.querySelectorAll("[data-anim]"), { x: 48, autoAlpha: 0 }, { x: 0, autoAlpha: 1, duration: 0.7, stagger: 0.08 }, 0.3)
          .fromTo(incoming.querySelector("[data-art]"), { scale: 0.86, autoAlpha: 0, rotate: 4 }, { scale: 1, autoAlpha: 1, rotate: 0, duration: 0.9 }, 0.25);
      }

      // autoplay progress bar (inactive bars get their state from CSS classes, so drop stale inline transforms)
      progressTween.current?.kill();
      gsap.utils.toArray<HTMLElement>("[data-bar]", el).forEach((b, i) => {
        if (i !== active) gsap.set(b, { clearProps: "transform" });
      });
      const bar = el.querySelector<HTMLElement>("[data-progress]");
      if (bar && count > 1) {
        progressTween.current = gsap.fromTo(bar, { scaleX: 0 }, { scaleX: 1, duration: AUTOPLAY_SEC, ease: "none", onComplete: () => setActive((a) => (a + 1) % count) });
        if (paused.current) progressTween.current.pause();
      }
    },
    { scope: root, dependencies: [active, count] },
  );

  // Mouse parallax (art + glow orbs)
  useGSAP(
    (_ctx, contextSafe) => {
      const el = root.current;
      if (!el || prefersReducedMotion() || !window.matchMedia("(hover: hover)").matches) return;
      const art = gsap.utils.toArray<HTMLElement>("[data-parallax]", el);
      const orbs = gsap.utils.toArray<HTMLElement>("[data-orb]", el);
      const setters = [...art.map((n) => ({ n, k: 18, x: gsap.quickTo(n, "x", { duration: 0.6, ease: "power3" }), y: gsap.quickTo(n, "y", { duration: 0.6, ease: "power3" }) })), ...orbs.map((n) => ({ n, k: -34, x: gsap.quickTo(n, "x", { duration: 1, ease: "power3" }), y: gsap.quickTo(n, "y", { duration: 1, ease: "power3" }) }))];
      const move = contextSafe!((e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        setters.forEach((s) => {
          s.x(nx * s.k);
          s.y(ny * s.k);
        });
      });
      const leave = contextSafe!(() => setters.forEach((s) => (s.x(0), s.y(0))));
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerleave", leave);
      return () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerleave", leave);
      };
    },
    { scope: root },
  );

  // Pause autoplay on hover/focus and while the tab is hidden
  React.useEffect(() => {
    const el = root.current;
    if (!el) return;
    const pause = () => {
      paused.current = true;
      progressTween.current?.pause();
    };
    const resume = () => {
      paused.current = false;
      progressTween.current?.resume();
    };
    const vis = () => (document.hidden ? pause() : resume());
    el.addEventListener("pointerenter", pause);
    el.addEventListener("pointerleave", resume);
    el.addEventListener("focusin", pause);
    el.addEventListener("focusout", resume);
    document.addEventListener("visibilitychange", vis);
    return () => {
      el.removeEventListener("pointerenter", pause);
      el.removeEventListener("pointerleave", resume);
      el.removeEventListener("focusin", pause);
      el.removeEventListener("focusout", resume);
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);

  if (count === 0) return null;
  const current = slides[active]!;

  return (
    <section
      ref={root}
      aria-roledescription="carousel"
      aria-label="Популярные предложения"
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") go(active - 1);
        if (e.key === "ArrowRight") go(active + 1);
      }}
      className="glass gradient-border relative isolate overflow-hidden rounded-3xl"
    >
      {/* blurred backdrop of the current cover */}
      {current.image && (
        <Image key={current.id} src={current.image} alt="" fill sizes="100vw" aria-hidden className="-z-20 scale-125 object-cover opacity-30 blur-3xl saturate-150 transition-opacity duration-700" />
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-background/85 via-background/55 to-transparent" />
      <div data-orb className="pointer-events-none absolute -top-24 -left-20 -z-10 size-80 rounded-full bg-primary/35 blur-3xl" />
      <div data-orb className="pointer-events-none absolute -right-16 -bottom-28 -z-10 size-80 rounded-full bg-accent/25 blur-3xl" />

      <div className="grid min-h-[22rem] sm:min-h-[26rem] lg:min-h-[28rem]">
        {slides.map((s, i) => {
          const pct = discountPercent(s.price, s.oldPrice);
          const plat = PLATFORMS.find((p) => p.value === s.platform)?.label ?? s.platform;
          return (
            <div
              key={s.id}
              data-slide
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} из ${count}`}
              aria-hidden={i !== active}
              className={cn("col-start-1 row-start-1 grid items-center gap-6 px-5 py-8 sm:px-10 sm:py-10 md:grid-cols-[1.15fr_0.85fr] lg:px-14", i !== active && "pointer-events-none invisible opacity-0")}
            >
              <div className="relative z-10 order-2 md:order-1">
                <div data-anim className="mb-3 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-primary/15 px-3 py-1 text-xs font-semibold text-primary">{s.categoryName}</span>
                  {plat && <span className="rounded-full bg-foreground/10 px-3 py-1 text-xs font-semibold">{plat}</span>}
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
                    <Zap className="size-3" /> Автовыдача
                  </span>
                </div>
                <h2 data-anim className="font-display text-2xl leading-tight font-bold sm:text-4xl lg:text-5xl">
                  <Link href={`/product/${s.slug}`} tabIndex={i === active ? 0 : -1} className="hover:text-primary">
                    {s.title}
                  </Link>
                </h2>
                {s.blurb && (
                  <p data-anim className="mt-3 line-clamp-3 max-w-xl text-sm text-muted-foreground sm:text-base">
                    {s.blurb}
                  </p>
                )}
                <div data-anim className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-display text-2xl font-bold sm:text-3xl">
                    {s.hasVariants && <span className="mr-1.5 text-sm font-medium text-muted-foreground">от</span>}
                    {formatRub(s.price)}
                  </span>
                  {s.oldPrice && <span className="text-muted-foreground line-through">{formatRub(s.oldPrice)}</span>}
                  {pct > 0 && <span className="gradient-brand rounded-lg px-2 py-0.5 text-sm font-bold text-white">-{pct}%</span>}
                </div>
                <div data-anim className="mt-6 flex flex-wrap gap-3">
                  <Button asChild size="lg" className="max-sm:h-12 max-sm:flex-1">
                    <Link href={`/product/${s.slug}`} tabIndex={i === active ? 0 : -1}>
                      Купить сейчас
                    </Link>
                  </Button>
                  <Button asChild size="lg" variant="glass" className="max-sm:h-12">
                    <Link href="/catalog" tabIndex={i === active ? 0 : -1}>
                      Весь каталог
                    </Link>
                  </Button>
                </div>
              </div>

              <div className="relative order-1 mx-auto w-40 sm:w-56 md:order-2 md:w-full md:max-w-[17rem] lg:max-w-xs" data-parallax>
                <div data-art className="relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/10 shadow-[0_30px_80px_-20px_var(--glow-violet)]">
                  {s.image ? (
                    <Image src={s.image} alt={s.title} fill priority={i === 0} sizes="(min-width: 1024px) 320px, 224px" className="object-cover" />
                  ) : (
                    <div className="gradient-brand size-full" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-tr from-primary/25 via-transparent to-accent/20 mix-blend-overlay" />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <>
          <div className="absolute inset-x-5 bottom-4 z-20 flex items-center gap-3 sm:inset-x-10 lg:inset-x-14">
            <div className="flex flex-1 gap-1.5" role="tablist" aria-label="Слайды">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  aria-label={`Слайд ${i + 1}: ${s.title}`}
                  onClick={() => go(i)}
                  className="group relative h-6 max-w-16 flex-1 cursor-pointer"
                >
                  <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-foreground/20">
                    <span data-bar data-progress={i === active ? "" : undefined} className={cn("block h-full origin-left rounded-full bg-gradient-to-r from-primary to-accent", i < active && "scale-x-100", i > active && "scale-x-0")} />
                  </span>
                </button>
              ))}
            </div>
            <div className="hidden gap-2 sm:flex">
              <Button variant="glass" size="icon-sm" aria-label="Предыдущий слайд" onClick={() => go(active - 1)}>
                <ChevronLeft />
              </Button>
              <Button variant="glass" size="icon-sm" aria-label="Следующий слайд" onClick={() => go(active + 1)}>
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
