"use client";
import * as React from "react";
import { CreditCard, KeyRound, PackageSearch, Star } from "lucide-react";
import { gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";

const STEPS = [
  { icon: PackageSearch, title: "Выберите товар", text: "Найдите игру, подписку или пополнение в каталоге — фильтры помогут подобрать регион и платформу." },
  { icon: CreditCard, title: "Оплатите удобно", text: "Банковская карта, СБП или баланс сайта. Платёж защищён, деньги у продавца только после выдачи." },
  { icon: KeyRound, title: "Получите сразу", text: "Ключ или доступ придёт автоматически в личный кабинет — обычно за пару минут." },
  { icon: Star, title: "Активируйте и оцените", text: "Что-то не так? Откройте спор — вернём деньги. Всё хорошо — оставьте отзыв продавцу." },
];

/** "How it works" steps. ScrollTrigger: the connector line draws while scrolling, steps pop in one by one. */
export function HowItWorks() {
  const ref = React.useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      const steps = gsap.utils.toArray<HTMLElement>("[data-step]", el);
      const line = el.querySelector<HTMLElement>("[data-line]");
      if (prefersReducedMotion()) {
        gsap.set([...steps, ...steps.map((s) => s.querySelector("[data-icon]"))], { opacity: 1, clearProps: "transform" });
        if (line) gsap.set(line, { scaleX: 1, scaleY: 1 });
        return;
      }
      const mm = gsap.matchMedia();
      mm.add("(min-width: 1024px)", () => {
        if (line) gsap.fromTo(line, { scaleX: 0 }, { scaleX: 1, ease: "none", transformOrigin: "left center", scrollTrigger: { trigger: el, start: "top 75%", end: "bottom 65%", scrub: 0.6 } });
      });
      mm.add("(max-width: 1023px)", () => {
        if (line) gsap.fromTo(line, { scaleY: 0 }, { scaleY: 1, ease: "none", transformOrigin: "center top", scrollTrigger: { trigger: el, start: "top 70%", end: "bottom 70%", scrub: 0.6 } });
      });
      steps.forEach((s, i) => {
        gsap.fromTo(s, { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, ease: "power3.out", delay: (i % 4) * 0.06, scrollTrigger: { trigger: s, start: "top 88%", once: true } });
        const icon = s.querySelector("[data-icon]");
        if (icon) gsap.fromTo(icon, { scale: 0.4, rotate: -25 }, { scale: 1, rotate: 0, duration: 0.8, ease: "back.out(2)", scrollTrigger: { trigger: s, start: "top 88%", once: true } });
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
      {/* connector line (desktop: horizontal through icons, mobile: vertical on the left) */}
      <div aria-hidden className="absolute top-7 right-[12.5%] left-[12.5%] hidden h-0.5 bg-border lg:block">
        <div data-line className="h-full origin-left rounded-full bg-gradient-to-r from-primary to-accent" />
      </div>
      <div aria-hidden className="absolute top-6 bottom-6 left-[2.15rem] w-0.5 bg-border sm:hidden">
        <div data-line className="h-full origin-top rounded-full bg-gradient-to-b from-primary to-accent" />
      </div>

      {STEPS.map(({ icon: Icon, title, text }, i) => (
        <div key={title} data-step className="glass relative flex gap-4 rounded-2xl p-4 sm:flex-col sm:p-5 lg:items-center lg:text-center">
          <span data-icon className="gradient-brand relative z-10 flex size-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-[0_8px_24px_-8px_var(--glow-violet)]">
            <Icon className="size-6" />
            <span className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border-2 border-background bg-foreground text-xs font-bold text-background">{i + 1}</span>
          </span>
          <div>
            <h3 className="font-display text-base font-semibold">{title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
