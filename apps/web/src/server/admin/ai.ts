import "server-only";
import { getSetting, prisma, type Prisma } from "@asap/db";
import { SETTING_KEYS } from "@asap/shared";
import { env } from "@/lib/env";

/**
 * Thin text-completion bridge used by the admin panel (metrics summary, dispute advice).
 * Provider order: Setting("ai.provider") ▸ AI_PROVIDER env, then the other configured providers; when nothing is configured
 * (or every call fails) the caller-supplied deterministic `fallback()` text is returned and flagged `mock: true`.
 * Every attempt is written to AiLog (visible in /admin/ai-logs). The platform-wide LLMProvider adapters live in zone F
 * (`src/server/ai`); this bridge only needs plain text so it talks to the three HTTP APIs directly and never throws.
 */

export type AiProviderName = "openai" | "anthropic" | "openrouter" | "mock";

export interface AiTextResult {
  text: string;
  provider: AiProviderName;
  model: string;
  /** true when no real provider answered (deterministic fallback text) */
  mock: boolean;
  error?: string;
}

const DEFAULT_MODELS: Record<Exclude<AiProviderName, "mock">, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-haiku-4-5",
  openrouter: "openai/gpt-4o-mini",
};

export function configuredProviders(): Exclude<AiProviderName, "mock">[] {
  const out: Exclude<AiProviderName, "mock">[] = [];
  if (env.ai.openaiKey) out.push("openai");
  if (env.ai.anthropicKey) out.push("anthropic");
  if (env.ai.openrouterKey) out.push("openrouter");
  return out;
}

async function callProvider(provider: Exclude<AiProviderName, "mock">, model: string, system: string, prompt: string): Promise<{ text: string; tokensIn: number; tokensOut: number }> {
  const signal = AbortSignal.timeout(45_000);
  if (provider === "anthropic") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ai.anthropicKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 900, system, messages: [{ role: "user", content: prompt }] }),
      signal,
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = (j.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n").trim();
    if (!text) throw new Error("anthropic: empty response");
    return { text, tokensIn: j.usage?.input_tokens ?? 0, tokensOut: j.usage?.output_tokens ?? 0 };
  }
  const isOpenRouter = provider === "openrouter";
  const res = await fetch(isOpenRouter ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${isOpenRouter ? env.ai.openrouterKey : env.ai.openaiKey}` },
    body: JSON.stringify({ model, temperature: 0.3, max_tokens: 900, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
    signal,
  });
  if (!res.ok) throw new Error(`${provider} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const text = j.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${provider}: empty response`);
  return { text, tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0 };
}

async function log(entry: { userId?: string; provider: string; model: string; task: string; input: Prisma.InputJsonValue; output?: Prisma.InputJsonValue; tokensIn?: number; tokensOut?: number; latencyMs: number; ok: boolean; error?: string }) {
  try {
    await prisma.aiLog.create({ data: { userId: entry.userId ?? null, provider: entry.provider, model: entry.model, task: entry.task, input: entry.input, output: entry.output, tokensIn: entry.tokensIn ?? 0, tokensOut: entry.tokensOut ?? 0, latencyMs: entry.latencyMs, ok: entry.ok, error: entry.error?.slice(0, 500) } });
  } catch (e) {
    console.warn("[admin-ai] AiLog write failed:", (e as Error).message);
  }
}

export async function aiComplete(args: {
  task: string;
  system: string;
  prompt: string;
  userId?: string;
  /** deterministic text used when no provider is configured or all providers failed */
  fallback: () => string;
  /** what to store as AiLog.input (default: the prompt); lets /admin/ai-logs link logs to entities */
  logInput?: Prisma.InputJsonValue;
}): Promise<AiTextResult> {
  const preferred = ((await getSetting<string>(SETTING_KEYS.aiProvider, env.ai.provider).catch(() => env.ai.provider)) || env.ai.provider || "mock").toLowerCase();
  const configuredModel = ((await getSetting<string>(SETTING_KEYS.aiModel, env.ai.model).catch(() => env.ai.model)) || env.ai.model || "").trim();
  const available = configuredProviders();
  const chain = preferred === "mock" ? [] : [...new Set([...(available.includes(preferred as never) ? [preferred as (typeof available)[number]] : []), ...available])];

  let lastError: string | undefined;
  for (const provider of chain) {
    // a model chosen for another provider is not valid here: only use it for the preferred provider
    const model = provider === preferred && configuredModel ? configuredModel : DEFAULT_MODELS[provider];
    const started = Date.now();
    try {
      const r = await callProvider(provider, model, args.system, args.prompt);
      await log({ userId: args.userId, provider, model, task: args.task, input: args.logInput ?? { prompt: args.prompt.slice(0, 4000) }, output: { text: r.text.slice(0, 4000) }, tokensIn: r.tokensIn, tokensOut: r.tokensOut, latencyMs: Date.now() - started, ok: true });
      return { text: r.text, provider, model, mock: false };
    } catch (e) {
      lastError = (e as Error).message;
      await log({ userId: args.userId, provider, model, task: args.task, input: args.logInput ?? { prompt: args.prompt.slice(0, 1000) }, latencyMs: Date.now() - started, ok: false, error: lastError });
    }
  }

  const started = Date.now();
  const text = args.fallback();
  await log({ userId: args.userId, provider: "mock", model: "rule-based", task: args.task, input: args.logInput ?? { prompt: args.prompt.slice(0, 1000) }, output: { text: text.slice(0, 4000) }, latencyMs: Date.now() - started, ok: true });
  return { text, provider: "mock", model: "rule-based", mock: true, error: lastError };
}
