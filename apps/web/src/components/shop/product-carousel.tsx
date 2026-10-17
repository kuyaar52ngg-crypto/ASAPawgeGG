"use client";
import * as React from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Horizontal, draggable product carousel (Embla). Children are the slides (server-rendered cards).
 * `controls` renders arrow buttons that sit above the track, aligned right.
 */
export function ProductCarousel({ children, className, label }: { children: React.ReactNode; className?: string; label: string }) {
  const [ref, api] = useEmblaCarousel({ align: "start", dragFree: true, containScroll: "trimSnaps", skipSnaps: true });
  const [canPrev, setCanPrev] = React.useState(false);
  const [canNext, setCanNext] = React.useState(true);

  React.useEffect(() => {
    if (!api) return;
    const update = () => {
      setCanPrev(api.canScrollPrev());
      setCanNext(api.canScrollNext());
    };
    update();
    api.on("select", update).on("reInit", update).on("scroll", update);
    return () => {
      api.off("select", update).off("reInit", update).off("scroll", update);
    };
  }, [api]);

  const slides = React.Children.toArray(children);

  return (
    <div className={cn("group/carousel relative", className)} role="region" aria-roledescription="carousel" aria-label={label}>
      <div className="overflow-hidden px-1 py-2 -mx-1 -my-2" ref={ref}>
        <div className="flex gap-3 sm:gap-4">
          {slides.map((s, i) => (
            <div key={i} className="min-w-0 shrink-0 grow-0 basis-[46%] sm:basis-[31%] md:basis-[24%] lg:basis-[19%] xl:basis-[18.5%]" role="group" aria-roledescription="slide">
              {s}
            </div>
          ))}
        </div>
      </div>
      <Button
        variant="glass"
        size="icon"
        aria-label="Назад"
        disabled={!canPrev}
        onClick={() => api?.scrollPrev()}
        className="absolute top-1/2 -left-3 z-20 hidden -translate-y-1/2 opacity-0 shadow-lg transition-opacity group-hover/carousel:opacity-100 focus-visible:opacity-100 disabled:!opacity-0 md:inline-flex"
      >
        <ChevronLeft />
      </Button>
      <Button
        variant="glass"
        size="icon"
        aria-label="Вперёд"
        disabled={!canNext}
        onClick={() => api?.scrollNext()}
        className="absolute top-1/2 -right-3 z-20 hidden -translate-y-1/2 opacity-0 shadow-lg transition-opacity group-hover/carousel:opacity-100 focus-visible:opacity-100 disabled:!opacity-0 md:inline-flex"
      >
        <ChevronRight />
      </Button>
    </div>
  );
}
