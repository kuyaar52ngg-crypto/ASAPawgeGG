"use client";
import * as React from "react";
import Link from "next/link";
import { Menu } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Logo } from "./logo";
import type { CategoryNode } from "@/server/categories";

export function MobileNav({ categories }: { categories: CategoryNode[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Открыть меню">
          <Menu />
        </Button>
      </DialogTrigger>
      <DialogContent side="left" className="gap-5">
        <DialogTitle className="sr-only">Меню</DialogTitle>
        <Logo />
        <nav className="grid gap-1" onClick={() => setOpen(false)}>
          <Link href="/catalog" className="rounded-xl px-3 py-2.5 font-semibold hover:bg-foreground/5">Весь каталог</Link>
          <Link href="/steam" className="rounded-xl px-3 py-2.5 font-semibold hover:bg-foreground/5">Пополнение Steam</Link>
          {categories.map((c) => (
            <div key={c.id} className="mt-2">
              <Link href={`/catalog?category=${c.slug}`} className="block px-3 py-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{c.name}</Link>
              {c.children.map((ch) => (
                <Link key={ch.id} href={`/catalog?category=${ch.slug}`} className="block rounded-lg px-3 py-2 text-sm hover:bg-foreground/5">{ch.name}</Link>
              ))}
            </div>
          ))}
        </nav>
      </DialogContent>
    </Dialog>
  );
}
