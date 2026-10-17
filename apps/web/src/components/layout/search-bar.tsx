"use client";
import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Clock, FolderOpen, Loader2, Search, X } from "lucide-react";
import { formatRub } from "@asap/shared/money";
import { cn } from "@/lib/utils";
import { reachGoal } from "@/lib/metrika";

interface SuggestData {
  q: string;
  total: number;
  products: { slug: string; title: string; image: string | null; price: number; hasVariants: boolean; platform: string | null }[];
  categories: { slug: string; name: string }[];
}

const HISTORY_KEY = "asap:search-history";

function readHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
function pushHistory(q: string) {
  try {
    const next = [q, ...readHistory().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 6);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

/** Header search with live suggestions (GET /api/search/suggest, Redis-cached 60s server-side). Submits to /search?q=… */
export function SearchBar({ className }: { className?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = React.useState(params.get("q") ?? "");
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<SuggestData | null>(null);
  const [history, setHistory] = React.useState<string[]>([]);
  const [active, setActive] = React.useState(-1);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const listId = React.useId();

  // fetch suggestions (debounced, abortable)
  React.useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const json = (await res.json()) as { ok: boolean; data?: SuggestData };
        if (json.ok && json.data) {
          setData(json.data);
          setActive(-1);
        }
      } catch {
        /* aborted / offline */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // close on outside click
  React.useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  const term = q.trim();
  const showResults = term.length >= 2 && data && data.q.toLowerCase() === term.replace(/\s+/g, " ").toLowerCase();
  const items: { href: string; key: string }[] = showResults
    ? [...data.categories.map((c) => ({ href: `/catalog/${c.slug}`, key: `c-${c.slug}` })), ...data.products.map((p) => ({ href: `/product/${p.slug}`, key: `p-${p.slug}` }))]
    : term.length < 2
      ? history.map((h) => ({ href: `/search?q=${encodeURIComponent(h)}`, key: `h-${h}` }))
      : [];

  function submit(value: string) {
    const v = value.trim();
    if (!v) return;
    pushHistory(v);
    reachGoal("search", { q: v });
    setOpen(false);
    router.push(`/search?q=${encodeURIComponent(v)}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (items.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActive((a) => (e.key === "ArrowDown" ? (a + 1) % items.length : (a - 1 + items.length) % items.length));
    }
    if (e.key === "Enter" && active >= 0 && items[active]) {
      e.preventDefault();
      setOpen(false);
      if (term) pushHistory(term);
      router.push(items[active]!.href);
    }
  }

  const optionCls = (idx: number) => cn("flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors", active === idx ? "bg-primary/15" : "hover:bg-foreground/5");

  return (
    <div ref={wrapRef} className={cn("relative w-full", className)}>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(q);
        }}
      >
        <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => {
            setHistory(readHistory());
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          type="search"
          name="q"
          autoComplete="off"
          enterKeyHint="search"
          role="combobox"
          aria-expanded={open && (items.length > 0 || Boolean(showResults))}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          placeholder="Поиск игр, подписок, пополнения Steam…"
          aria-label="Поиск по каталогу"
          className="h-11 w-full rounded-xl border border-input bg-foreground/[0.05] pr-10 pl-10 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/30 [&::-webkit-search-cancel-button]:hidden"
        />
        {loading && term.length >= 2 ? (
          <Loader2 className="absolute top-1/2 right-3.5 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : q ? (
          <button type="button" aria-label="Очистить" onClick={() => (setQ(""), setData(null))} className="absolute top-1/2 right-2.5 flex size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground hover:bg-foreground/10">
            <X className="size-4" />
          </button>
        ) : null}
      </form>

      {open && (items.length > 0 || showResults) && (
        <div id={listId} role="listbox" aria-label="Подсказки поиска" className="glass absolute top-full right-0 left-0 z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-2xl border border-border bg-popover/95 p-2 shadow-2xl backdrop-blur-xl">
          {term.length < 2 && (
            <>
              <p className="px-2.5 pt-1 pb-1.5 text-xs font-semibold text-muted-foreground">Недавние запросы</p>
              {history.map((h, i) => (
                <Link key={h} id={`${listId}-${i}`} role="option" aria-selected={active === i} href={`/search?q=${encodeURIComponent(h)}`} onClick={() => setOpen(false)} className={optionCls(i)}>
                  <Clock className="size-4 text-muted-foreground" /> {h}
                </Link>
              ))}
            </>
          )}
          {showResults && (
            <>
              {data.categories.map((c, i) => (
                <Link key={c.slug} id={`${listId}-${i}`} role="option" aria-selected={active === i} href={`/catalog/${c.slug}`} onClick={() => (pushHistory(term), setOpen(false))} className={optionCls(i)}>
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <FolderOpen className="size-4" />
                  </span>
                  <span>
                    <span className="block font-semibold">{c.name}</span>
                    <span className="text-xs text-muted-foreground">Категория</span>
                  </span>
                </Link>
              ))}
              {data.products.map((p, j) => {
                const i = data.categories.length + j;
                return (
                  <Link key={p.slug} id={`${listId}-${i}`} role="option" aria-selected={active === i} href={`/product/${p.slug}`} onClick={() => (pushHistory(term), setOpen(false))} className={optionCls(i)}>
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-muted">{p.image && <Image src={p.image} alt="" fill sizes="40px" className="object-cover" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{p.title}</span>
                      {p.platform && <span className="text-xs text-muted-foreground">{p.platform}</span>}
                    </span>
                    <span className="shrink-0 text-sm font-semibold">
                      {p.hasVariants && <span className="mr-1 text-xs font-normal text-muted-foreground">от</span>}
                      {formatRub(p.price)}
                    </span>
                  </Link>
                );
              })}
              {data.products.length === 0 && data.categories.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">Ничего не найдено по «{data.q}»</p>}
              {data.products.length > 0 && (
                <Link href={`/search?q=${encodeURIComponent(term)}`} onClick={() => (pushHistory(term), setOpen(false))} className="mt-1 block rounded-xl px-3 py-2.5 text-center text-sm font-semibold text-primary hover:bg-primary/10">
                  Все результаты{data.total > data.products.length ? ` (${data.total})` : ""}
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
