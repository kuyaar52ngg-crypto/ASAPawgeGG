"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { gsap, prefersReducedMotion, useGSAP } from "@/lib/gsap";
import { cn } from "@/lib/utils";
import { linkify } from "./linkify";
import { SseParser } from "./sse";

interface Msg {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** assistant answer produced by the offline demo engine */
  mock?: boolean;
  error?: boolean;
}

const SUGGESTIONS = ["Найди подписку Spotify", "Как оплатить и получить ключ?", "Где мой заказ?", "Как вернуть деньги?"];
const STORAGE_KEY = "asap_support_chat_v1";
const GREETING = "Здравствуйте! Я помощник ASAPawgeGG. Помогу подобрать товар, узнать статус заказа или ответить на вопросы об оплате и выдаче.";
const TOOL_LABELS: Record<string, string> = { search_products: "Ищу в каталоге…", get_order_status: "Проверяю заказ…", get_faq: "Смотрю в базе знаний…", create_support_ticket: "Передаю обращение администратору…" };

function RichText({ text, onNavigate }: { text: string; onNavigate: () => void }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.kind === "text" ? (
          <span key={i}>{p.text}</span>
        ) : p.external ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-primary underline underline-offset-2">
            {p.text}
          </a>
        ) : (
          <Link key={i} href={p.href} onClick={onNavigate} className="break-all text-primary underline underline-offset-2">
            {p.text}
          </Link>
        ),
      )}
    </>
  );
}

/** Floating AI support chat: streams answers from POST /api/ai/chat (SSE). Mounted once in the root layout. */
export function SupportChat() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [unread, setUnread] = useState(true);
  const idRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hydrated = useRef(false);

  // restore the conversation of this tab (best effort: storage can be blocked)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        const saved = raw ? (JSON.parse(raw) as Msg[]) : null;
        if (Array.isArray(saved)) {
          const ok = saved.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-40);
          setMessages(ok);
          idRef.current = ok.length + 1;
          if (ok.length) setUnread(false);
        }
      } catch {
        /* ignore */
      }
      hydrated.current = true;
    }, 0);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (!hydrated.current || busy) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      /* ignore */
    }
  }, [messages, busy]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // GSAP: panel opens with a springy scale-in, the launcher pulses until first opened
  useGSAP(
    () => {
      if (!panelRef.current) return;
      if (prefersReducedMotion()) {
        gsap.set(panelRef.current, { autoAlpha: open ? 1 : 0, y: 0, scale: 1 });
        return;
      }
      if (open) {
        gsap.fromTo(panelRef.current, { autoAlpha: 0, y: 28, scale: 0.92, transformOrigin: "100% 100%" }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.45, ease: "back.out(1.5)" });
        gsap.from(panelRef.current.querySelectorAll("[data-chat-intro]"), { autoAlpha: 0, y: 10, duration: 0.35, stagger: 0.07, delay: 0.15, ease: "power2.out" });
      } else {
        gsap.to(panelRef.current, { autoAlpha: 0, y: 16, scale: 0.96, duration: 0.2, ease: "power2.in" });
      }
    },
    { dependencies: [open], scope: panelRef },
  );
  useGSAP(
    () => {
      if (!fabRef.current || !unread || open || prefersReducedMotion()) return;
      gsap.fromTo(fabRef.current, { scale: 1 }, { scale: 1.08, duration: 0.9, yoyo: true, repeat: -1, ease: "sine.inOut" });
      return () => {
        gsap.set(fabRef.current, { scale: 1 });
      };
    },
    { dependencies: [unread, open], scope: fabRef },
  );

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [open]);

  const send = useCallback(
    async (textRaw: string) => {
      const text = textRaw.trim().slice(0, 2000);
      if (!text || busy) return;
      const userMsg: Msg = { id: ++idRef.current, role: "user", content: text };
      const botId = ++idRef.current;
      setMessages((m) => [...m, userMsg, { id: botId, role: "assistant", content: "" }]);
      setInput("");
      setBusy(true);
      setStatus(null);
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const history = [...messages, userMsg].filter((m) => !m.error && m.content).slice(-12).map((m) => ({ role: m.role, content: m.content }));
      const patch = (fn: (m: Msg) => Msg) => setMessages((all) => all.map((m) => (m.id === botId ? fn(m) : m)));
      try {
        const res = await fetch("/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history }), signal: ctrl.signal });
        if (!res.ok || !res.body) {
          let msg = "Не удалось получить ответ. Попробуйте позже.";
          if (res.status === 429) msg = "Слишком много сообщений. Подождите пару минут и попробуйте снова.";
          patch((m) => ({ ...m, content: msg, error: true }));
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = new SseParser();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const ev of parser.push(decoder.decode(value, { stream: true }))) {
            if (ev.type === "text") {
              setStatus(null);
              patch((m) => ({ ...m, content: m.content + ev.delta }));
            } else if (ev.type === "tool") setStatus(TOOL_LABELS[ev.name] ?? "Думаю…");
            else if (ev.type === "done") patch((m) => ({ ...m, mock: ev.mock }));
            else if (ev.type === "error") patch((m) => ({ ...m, content: m.content || ev.message, error: true }));
          }
        }
        patch((m) => (m.content ? m : { ...m, content: "Ответ пустой. Переформулируйте вопрос, пожалуйста.", error: true }));
      } catch (e) {
        if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, content: m.content || "Соединение прервано. Попробуйте ещё раз.", error: true }));
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [busy, messages],
  );

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setBusy(false);
    setStatus(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  };

  if (pathname.startsWith("/admin")) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-end px-4 pb-4 sm:px-6 sm:pb-6" data-support-chat>
      <div className="pointer-events-none flex flex-col items-end gap-3">
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Чат поддержки"
          aria-hidden={!open}
          className={cn("glass flex h-[min(34rem,calc(100dvh-7rem))] w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl sm:w-[24rem]", open ? "pointer-events-auto" : "invisible")}
          style={{ opacity: 0 }}
        >
          <header className="flex items-center gap-3 border-b border-border px-4 py-3">
            <span className="gradient-brand grid size-9 place-items-center rounded-xl text-white">
              <Bot className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold leading-tight">Помощник ASAPawge GG</p>
              <p className="text-xs text-muted-foreground">Отвечает мгновенно · 24/7</p>
            </div>
            {messages.length > 0 && (
              <button type="button" onClick={reset} className="rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-foreground/7 hover:text-foreground" aria-label="Начать новый диалог">
                Очистить
              </button>
            )}
            <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-foreground/7 hover:text-foreground" aria-label="Закрыть чат">
              <X className="size-4" />
            </button>
          </header>

          <div ref={listRef} className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            <div data-chat-intro className="max-w-[88%] rounded-2xl rounded-tl-md bg-secondary px-3.5 py-2.5 text-sm leading-relaxed">
              {GREETING}
            </div>
            {messages.length === 0 && (
              <div data-chat-intro className="flex flex-wrap gap-2 pt-1">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" onClick={() => void send(s)} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:border-primary/60 hover:bg-primary/10">
                    <Sparkles className="size-3 text-primary" />
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) => (
              <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[88%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                    m.role === "user" ? "gradient-brand rounded-tr-md text-white" : m.error ? "rounded-tl-md bg-destructive/15 text-destructive" : "rounded-tl-md bg-secondary",
                  )}
                >
                  {m.role === "assistant" ? (m.content ? <RichText text={m.content} onNavigate={() => setOpen(false)} /> : <TypingDots />) : m.content}
                  {m.role === "assistant" && m.mock && !!m.content && <span className="mt-1.5 block text-[10px] uppercase tracking-wide text-muted-foreground">демо-режим ИИ · без внешней модели</span>}
                </div>
              </div>
            ))}
            {status && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3 animate-spin" />
                {status}
              </p>
            )}
          </div>

          <form
            className="flex items-end gap-2 border-t border-border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Напишите вопрос…"
              aria-label="Сообщение"
              className="max-h-28 min-h-10 flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
            />
            <button type="submit" disabled={busy || !input.trim()} className="gradient-brand grid size-10 shrink-0 place-items-center rounded-xl text-white transition disabled:opacity-40" aria-label="Отправить">
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </form>
        </div>

        <button
          ref={fabRef}
          type="button"
          onClick={() => {
            setOpen((v) => !v);
            setUnread(false);
          }}
          aria-expanded={open}
          aria-label={open ? "Закрыть чат поддержки" : "Открыть чат поддержки"}
          className="gradient-brand pointer-events-auto relative grid size-14 place-items-center rounded-full text-white shadow-[0_10px_30px_-8px_var(--glow-violet)] transition hover:brightness-110"
        >
          {open ? <X className="size-6" /> : <MessageCircle className="size-6" />}
          {unread && !open && <span className="absolute right-0.5 top-0.5 size-3 rounded-full border-2 border-background bg-success" />}
        </button>
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1 py-1" aria-label="Печатает">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 0.15}s` }} />
      ))}
    </span>
  );
}
