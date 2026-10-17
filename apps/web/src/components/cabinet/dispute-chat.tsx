"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Send, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { closeDisputeAction, escalateDisputeAction, sendDisputeMessageAction } from "@/server/cabinet/dispute-actions";
import type { ChatMessage } from "@/server/cabinet/disputes";
import { ACTIVE_DISPUTE_STATUSES, CHAT_POLL_MS } from "./constants";
import { DisputeStatusBadge, formatDateTime } from "./labels";

/**
 * Dispute chat (buyer ↔ seller ↔ admin). Polls GET /api/cabinet/disputes/:id/messages every 5 s (paused while the tab is hidden)
 * and appends new messages by id. Reusable by the admin zone (viewerRole="ADMIN").
 */
export function DisputeChat({
  disputeId,
  initialMessages,
  initialStatus,
  viewerId,
  viewerRole,
}: {
  disputeId: string;
  initialMessages: ChatMessage[];
  initialStatus: string;
  viewerId: string;
  viewerRole: "USER" | "SELLER" | "ADMIN";
}) {
  const router = useRouter();
  const [messages, setMessages] = React.useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = React.useState(initialStatus);
  const [body, setBody] = React.useState("");
  const [sending, startSend] = React.useTransition();
  const [acting, startAct] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const lastAt = React.useRef(initialMessages.at(-1)?.createdAt);
  const canPost = (ACTIVE_DISPUTE_STATUSES as readonly string[]).includes(status);

  const merge = React.useCallback((incoming: ChatMessage[]) => {
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return prev;
      lastAt.current = fresh.at(-1)!.createdAt;
      return [...prev, ...fresh];
    });
  }, []);

  // polling
  React.useEffect(() => {
    let stop = false;
    async function tick() {
      if (stop || document.visibilityState === "hidden") return;
      try {
        const qs = lastAt.current ? `?after=${encodeURIComponent(lastAt.current)}` : "";
        const res = await fetch(`/api/cabinet/disputes/${disputeId}/messages${qs}`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { ok: boolean; data?: { messages: ChatMessage[]; status: string } };
        if (stop || !json.ok || !json.data) return;
        merge(json.data.messages);
        setStatus(json.data.status);
      } catch {
        /* offline — retry on next tick */
      }
    }
    const timer = setInterval(tick, CHAT_POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [disputeId, merge]);

  // keep scrolled to the newest message
  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function send(e: React.FormEvent) {
    e.preventDefault();
    const text = body.trim();
    if (!text) return;
    setError(null);
    startSend(async () => {
      const res = await sendDisputeMessageAction({ disputeId, body: text });
      if (res.ok) {
        setBody("");
        merge([res.data.message]);
      } else setError(res.error);
    });
  }

  function act(fn: (id: string) => ReturnType<typeof closeDisputeAction>, success: string, nextStatus: string) {
    startAct(async () => {
      const res = await fn(disputeId);
      if (res.ok) {
        toast.success(success);
        setStatus(nextStatus);
        router.refresh();
      } else toast.error(res.error);
    });
  }

  return (
    <div className="glass flex flex-col overflow-hidden rounded-2xl">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">Чат по спору <DisputeStatusBadge status={status} /></div>
        {canPost && viewerRole !== "ADMIN" && (
          <div className="flex flex-wrap gap-2">
            {status !== "ESCALATED" && (
              <Button type="button" size="sm" variant="outline" loading={acting} onClick={() => act(escalateDisputeAction, "Администратор подключён к спору", "ESCALATED")}>
                <ShieldAlert /> Позвать администратора
              </Button>
            )}
            {viewerRole === "USER" && (
              <Button type="button" size="sm" variant="outline" loading={acting} onClick={() => act(closeDisputeAction, "Спор закрыт", "CLOSED")}>
                <CheckCircle2 /> Вопрос решён
              </Button>
            )}
          </div>
        )}
      </div>

      <div ref={listRef} className="flex max-h-[28rem] min-h-64 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        {messages.map((m) => {
          const mine = m.authorId === viewerId;
          const system = m.authorRole === "SYSTEM" || m.authorRole === "AI";
          if (system) {
            return (
              <div key={m.id} className="mx-auto max-w-[90%] rounded-xl bg-foreground/5 px-3 py-2 text-center text-xs text-muted-foreground">
                <span className="font-semibold">{m.authorRole === "AI" ? "AI-ассистент: " : ""}</span>
                {m.body}
              </div>
            );
          }
          return (
            <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
              <span className="mb-0.5 px-1 text-[11px] text-muted-foreground">
                {mine ? "Вы" : m.authorName} · {formatDateTime(m.createdAt)}
              </span>
              <p className={cn("max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap", mine ? "gradient-brand text-white" : m.authorRole === "ADMIN" ? "border border-accent/40 bg-accent/10" : "bg-secondary")}>{m.body}</p>
            </div>
          );
        })}
      </div>

      {canPost ? (
        <form onSubmit={send} className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(e);
              }}
              maxLength={4000}
              placeholder="Напишите сообщение…  (Ctrl+Enter — отправить)"
              className="max-h-40 min-h-12 flex-1"
              aria-label="Сообщение"
            />
            <Button type="submit" size="icon" disabled={sending || !body.trim()} aria-label="Отправить">
              {sending ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
          {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        </form>
      ) : (
        <p className="border-t border-border px-4 py-3 text-center text-sm text-muted-foreground">Спор закрыт — новые сообщения недоступны.</p>
      )}
    </div>
  );
}
