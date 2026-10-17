"use client";
import * as React from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/** Main image + thumbnails. Hover zoom on pointer devices. */
export function ProductGallery({ images, title }: { images: string[]; title: string }) {
  const [active, setActive] = React.useState(0);
  const [zoom, setZoom] = React.useState<{ x: number; y: number } | null>(null);
  const list = images.length > 0 ? images : [];
  const current = list[active];

  return (
    <div className="space-y-3">
      <div
        className="glass relative aspect-[4/5] overflow-hidden rounded-2xl sm:aspect-[3/4]"
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse") return;
          const r = e.currentTarget.getBoundingClientRect();
          setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
        }}
        onPointerLeave={() => setZoom(null)}
      >
        {current ? (
          <Image
            key={current}
            src={current}
            alt={title}
            fill
            priority
            sizes="(min-width: 1024px) 420px, (min-width: 640px) 50vw, 100vw"
            className="object-cover transition-transform duration-200 ease-out"
            style={zoom ? { transform: "scale(1.6)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
          />
        ) : (
          <div className="gradient-brand flex size-full items-center justify-center font-display text-6xl font-bold text-white/80">{title.slice(0, 1)}</div>
        )}
      </div>
      {list.length > 1 && (
        <div className="grid grid-cols-5 gap-2" role="tablist" aria-label="Изображения товара">
          {list.slice(0, 5).map((src, i) => (
            <button
              key={src}
              type="button"
              role="tab"
              aria-selected={i === active}
              aria-label={`Изображение ${i + 1}`}
              onClick={() => setActive(i)}
              className={cn("relative aspect-square cursor-pointer overflow-hidden rounded-xl border-2 transition-all", i === active ? "border-primary" : "border-transparent opacity-70 hover:opacity-100")}
            >
              <Image src={src} alt="" fill sizes="80px" className="object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
