import OpenAI from "openai";
import type { ChatCompletionChunk, ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { AiProviderError, type ChatMessage, type ChatOptions, type ChatResult, type LLMProvider, type ProviderName, type StreamEvent, type ToolCall } from "../types";

interface Config {
  name: ProviderName;
  apiKey: string;
  baseURL?: string;
  defaultModel: string;
  defaultHeaders?: Record<string, string>;
}

function toOpenAiMessages(messages: ChatMessage[]): ChatCompletionMessageParam[] {
  return messages.map((m): ChatCompletionMessageParam => {
    if (m.role === "tool") return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((t) => ({ id: t.id, type: "function" as const, function: { name: t.name, arguments: JSON.stringify(t.arguments) } })),
      };
    }
    return { role: m.role, content: m.content } as ChatCompletionMessageParam;
  });
}

function toOpenAiTools(opts?: ChatOptions): ChatCompletionTool[] | undefined {
  if (!opts?.tools?.length) return undefined;
  return opts.tools.map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.parameters as Record<string, unknown> } }));
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function stop(reason: string | null | undefined, hasTools: boolean): ChatResult["stopReason"] {
  if (hasTools || reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  if (reason === "stop") return "end";
  return "other";
}

/** Shared adapter for every OpenAI-wire-compatible API (OpenAI itself and OpenRouter). Uses the official `openai` SDK. */
export class OpenAiCompatibleProvider implements LLMProvider {
  readonly name: ProviderName;
  private client: OpenAI | null = null;

  constructor(private readonly cfg: Config) {
    this.name = cfg.name;
  }

  isConfigured(): boolean {
    return Boolean(this.cfg.apiKey);
  }

  defaultModel(): string {
    return this.cfg.defaultModel;
  }

  private sdk(): OpenAI {
    this.client ??= new OpenAI({ apiKey: this.cfg.apiKey, baseURL: this.cfg.baseURL, defaultHeaders: this.cfg.defaultHeaders, timeout: 45_000, maxRetries: 1 });
    return this.client;
  }

  private params(messages: ChatMessage[], opts: ChatOptions | undefined) {
    return {
      model: opts?.model || this.cfg.defaultModel,
      messages: toOpenAiMessages(messages),
      tools: toOpenAiTools(opts),
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 1200,
      ...(opts?.json ? { response_format: { type: "json_object" as const } } : {}),
    };
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    try {
      const p = this.params(messages, opts);
      const res = await this.sdk().chat.completions.create({ ...p, stream: false }, { signal: opts?.signal });
      const choice = res.choices[0];
      if (!choice) throw new AiProviderError("empty response", this.name);
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).flatMap((t) => (t.type === "function" ? [{ id: t.id, name: t.function.name, arguments: parseArgs(t.function.arguments) }] : []));
      return {
        content: choice.message.content ?? "",
        toolCalls,
        usage: { tokensIn: res.usage?.prompt_tokens ?? 0, tokensOut: res.usage?.completion_tokens ?? 0 },
        provider: this.name,
        model: res.model || p.model,
        stopReason: stop(choice.finish_reason, toolCalls.length > 0),
      };
    } catch (e) {
      throw e instanceof AiProviderError ? e : new AiProviderError(`${this.name}: ${(e as Error).message}`, this.name);
    }
  }

  async *stream(messages: ChatMessage[], opts?: ChatOptions): AsyncGenerator<StreamEvent, void, void> {
    const p = this.params(messages, opts);
    let content = "";
    let finish: string | null = null;
    let usage = { tokensIn: 0, tokensOut: 0 };
    const calls = new Map<number, { id: string; name: string; args: string }>();
    try {
      const stream = await this.sdk().chat.completions.create({ ...p, stream: true, stream_options: { include_usage: true } }, { signal: opts?.signal });
      for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
        if (chunk.usage) usage = { tokensIn: chunk.usage.prompt_tokens ?? 0, tokensOut: chunk.usage.completion_tokens ?? 0 };
        const choice = chunk.choices[0];
        if (!choice) continue;
        const delta = choice.delta.content;
        if (delta) {
          content += delta;
          yield { type: "text", delta };
        }
        for (const tc of choice.delta.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(tc.index, cur);
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    } catch (e) {
      throw e instanceof AiProviderError ? e : new AiProviderError(`${this.name}: ${(e as Error).message}`, this.name);
    }
    const toolCalls: ToolCall[] = [...calls.entries()].sort((a, b) => a[0] - b[0]).filter(([, c]) => c.name).map(([i, c]) => ({ id: c.id || `call_${i}`, name: c.name, arguments: parseArgs(c.args) }));
    yield { type: "done", result: { content, toolCalls, usage, provider: this.name, model: p.model, stopReason: stop(finish, toolCalls.length > 0) } };
  }
}
