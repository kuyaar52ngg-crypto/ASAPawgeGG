import "server-only";
import { prisma, type Prisma } from "@asap/db";
import type { ChainLink } from "./chain";
import { resolveChain } from "./registry";
import { AiProviderError, type ChatMessage, type ChatOptions, type ChatResult, type StreamEvent } from "./types";

/** Short, non-sensitive preview of the conversation for AiLog.input (never full histories, never stock secrets). */
function previewInput(messages: ChatMessage[], extra?: Record<string, unknown>): Prisma.InputJsonValue {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return { ...extra, messages: messages.length, lastUser: lastUser ? lastUser.content.slice(0, 1500) : null } as Prisma.InputJsonValue;
}

function previewOutput(r: ChatResult): Prisma.InputJsonValue {
  return { text: r.content.slice(0, 3000), toolCalls: r.toolCalls.map((t) => t.name), stopReason: r.stopReason } as Prisma.InputJsonValue;
}

export interface LogArgs {
  userId?: string | null;
  provider: string;
  model: string;
  task: string;
  input?: Prisma.InputJsonValue;
  output?: Prisma.InputJsonValue;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs: number;
  ok: boolean;
  error?: string;
}

/** Writes one AiLog row; never throws (logging must not break a user flow). */
export async function writeAiLog(a: LogArgs): Promise<void> {
  try {
    await prisma.aiLog.create({
      data: { userId: a.userId ?? null, provider: a.provider, model: a.model, task: a.task, input: a.input, output: a.output, tokensIn: a.tokensIn ?? 0, tokensOut: a.tokensOut ?? 0, latencyMs: a.latencyMs, ok: a.ok, error: a.error?.slice(0, 500) },
    });
  } catch (e) {
    console.warn("[ai] AiLog write failed:", (e as Error).message);
  }
}

export interface CallArgs {
  /** AiLog.task: describe | moderation | metrics_summary | support_chat | ... */
  task: string;
  userId?: string | null;
  messages: ChatMessage[];
  opts?: Omit<ChatOptions, "model">;
  /** extra non-sensitive fields stored in AiLog.input */
  logInput?: Record<string, unknown>;
  /** append the offline provider as last resort (support chat) */
  withMock?: boolean;
  /** pre-resolved chain (agents resolve once and drop failed links between steps) */
  chain?: ChainLink[];
}

/**
 * Non-streaming completion over the fallback chain. Each attempt (success or failure) is logged.
 * Returns null when no provider is configured / every provider failed (callers then use their offline heuristic).
 */
export async function complete(a: CallArgs): Promise<ChatResult | null> {
  const chain = a.chain ?? (await resolveChain({ withMock: a.withMock ?? false }));
  for (const link of [...chain]) {
    const started = Date.now();
    try {
      const res = await link.provider.chat(a.messages, { ...a.opts, model: link.model });
      await writeAiLog({ userId: a.userId, provider: res.provider, model: res.model, task: a.task, input: previewInput(a.messages, a.logInput), output: previewOutput(res), tokensIn: res.usage.tokensIn, tokensOut: res.usage.tokensOut, latencyMs: Date.now() - started, ok: true });
      return res;
    } catch (e) {
      await writeAiLog({ userId: a.userId, provider: link.provider.name, model: link.model, task: a.task, input: previewInput(a.messages, a.logInput), latencyMs: Date.now() - started, ok: false, error: (e as Error).message });
      if (e instanceof AiProviderError && !e.retryable) {
        const i = chain.indexOf(link);
        if (i >= 0 && a.chain) chain.splice(i, 1);
      }
    }
  }
  return null;
}

/**
 * Streaming completion with fallback: a provider may be abandoned only BEFORE it emitted visible text
 * (after that the error is re-thrown, so the client never sees two answers glued together).
 */
export async function* streamComplete(a: CallArgs): AsyncGenerator<StreamEvent, void, void> {
  const chain = a.chain ?? (await resolveChain({ withMock: a.withMock ?? false }));
  let lastError: Error | null = null;
  for (const link of [...chain]) {
    const started = Date.now();
    let emitted = false;
    try {
      for await (const ev of link.provider.stream(a.messages, { ...a.opts, model: link.model })) {
        if (ev.type === "text") emitted = true;
        if (ev.type === "done") {
          const res = ev.result;
          await writeAiLog({ userId: a.userId, provider: res.provider, model: res.model, task: a.task, input: previewInput(a.messages, a.logInput), output: previewOutput(res), tokensIn: res.usage.tokensIn, tokensOut: res.usage.tokensOut, latencyMs: Date.now() - started, ok: true });
        }
        yield ev;
      }
      return;
    } catch (e) {
      lastError = e as Error;
      await writeAiLog({ userId: a.userId, provider: link.provider.name, model: link.model, task: a.task, input: previewInput(a.messages, a.logInput), latencyMs: Date.now() - started, ok: false, error: lastError.message });
      if (emitted) throw lastError;
      if (a.chain) {
        const i = chain.indexOf(link);
        if (i >= 0) chain.splice(i, 1); // do not retry a failing provider on the next agent step
      }
    }
  }
  throw lastError ?? new Error("no AI provider available");
}
