"use client";
import * as React from "react";
import Link from "next/link";
import { ChevronRight, LayoutGrid } from "lucide-react";
import { CategoryIcon } from "@/components/ui/category-icon";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { CategoryNode } from "@/server/categories";

export function CatalogMenu({ categories }: { categories: CategoryNode[] }) {
  const [open, setOpen] = React.useState(false);
  const [activeId, setActiveId] = React.useState(categories[0]?.id);
  const active = categories.find((c) => c.id === activeId) ?? categories[0];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="default" className="hidden lg:inline-flex">
          <LayoutGrid /> Каталог
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="grid w-[640px] grid-cols-[240px_1fr] gap-0 overflow-hidden p-0">
        <ul className="border-r border-border p-2">
          {categories.map((c) => (
            <li key={c.id}>
              <Link
                href={`/catalog?category=${c.slug}`}
                onMouseEnter={() => setActiveId(c.id)}
                onFocus={() => setActiveId(c.id)}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${active?.id === c.id ? "bg-primary/15 text-foreground" : "text-foreground/80 hover:bg-foreground/5"}`}
              >
                <CategoryIcon name={c.icon} className="size-4 text-primary" />
                <span className="flex-1">{c.name}</span>
                {c.children.length > 0 && <ChevronRight className="size-4 text-muted-foreground" />}
              </Link>
            </li>
          ))}
        </ul>
        <div className="p-4">
          {active && (
            <>
              <Link href={`/catalog?category=${active.slug}`} onClick={() => setOpen(false)} className="font-display text-base font-semibold hover:text-primary">
                {active.name}
              </Link>
              {active.description && <p className="mt-1 text-xs text-muted-foreground">{active.description}</p>}
              <ul className="mt-3 grid gap-0.5">
                {active.children.length === 0 && <li className="text-sm text-muted-foreground">Смотреть все товары категории →</li>}
                {active.children.map((ch) => (
                  <li key={ch.id}>
                    <Link href={`/catalog?category=${ch.slug}`} onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground/85 hover:bg-foreground/5 hover:text-foreground">
                      <CategoryIcon name={ch.icon} className="size-4 text-accent" />
                      {ch.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
