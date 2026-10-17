import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { AiProviderError, type ChatMessage, type ChatOptions, type ChatResult, type LLMProvider, type StreamEvent, type ToolCall } from "../types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-5-5";

/** Splits our neutral messages into Anthropic's `system` string + alternating user/assistant turns (tool results ride on user turns). */
export function toAnthropicMessages(messages: ChatMessage[]): { system: string; messages: Anthropic.MessageParam[] } {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const out: Anthropic.MessageParam[] = [];
  const push = (role: "user" | "assistant", blocks: Anthropic.ContentBlockParam[]) => {
    const last = out[out.length - 1];
    if (last && last.role === role && Array.isArray(last.content)) last.content.push(...blocks);
    else out.push({ role, content: blocks });
  };
  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "user") push("user", [{ type: "text", text: m.content }]);
    else if (m.role === "tool") push("user", [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }]);
    else {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const t of m.toolCalls ?? []) blocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.arguments });
      if (blocks.length) push("assistant", blocks);
    }
  }
  return { system, messages: out };
}

function stopReason(r: string | null | undefined): ChatResult["stopReason"] {
  if (r === "tool_use") return "tool_calls";
  if (r === "max_tokens") return "length";
  if (r === "end_turn" || r === "stop_sequence") return "end";
  return "other";
}

function fromMessage(msg: Anthropic.Message): ChatResult {
  let content = "";
  const toolCalls: ToolCall[] = [];
  for (const b of msg.content) {
    if (b.type === "text") content += b.text;
    else if (b.type === "tool_use") toolCalls.push({ id: b.id, name: b.name, arguments: b.input && typeof b.input === "object" ? (b.input as Record<string, unknown>) : {} });
  }
  return { content, toolCalls, usage: { tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens }, provider: "anthropic", model: msg.model, stopReason: stopReason(msg.stop_reason) };
}

/**
 * Anthropic Claude via the official `@anthropic-ai/sdk`. Default model `claude-sonnet-5-5` (override: Setting ai.model ▸ AI_MODEL).
 * Sonnet 5.5 rejects non-default sampling params, so `temperature` is intentionally never sent.
 */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic" as const;
  private client: Anthropic | null = null;

  isConfigured(): boolean {
    return Boolean(env.ai.anthropicKey);
  }

  defaultModel(): string {
    return DEFAULT_ANTHROPIC_MODEL;
  }

  private sdk(): Anthropic {
    this.client ??= new Anthropic({ apiKey: env.ai.anthropicKey, timeout: 60_000, maxRetries: 1 });
    return this.client;
  }

  private params(messages: ChatMessage[], opts?: ChatOptions): Anthropic.MessageCreateParamsNonStreaming {
    const { system, messages: msgs } = toAnthropicMessages(messages);
    const jsonHint = opts?.json ? "\n\nRespond with a single valid JSON object and nothing else." : "";
    return {
      model: opts?.model || DEFAULT_ANTHROPIC_MODEL,
      max_tokens: opts?.maxTokens ?? 1500,
      ...(system || jsonHint ? { system: system + jsonHint } : {}),
      messages: msgs,
      ...(opts?.tools?.length ? { tools: opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters as Anthropic.Tool.InputSchema })) } : {}),
    };
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    try {
      const res = await this.sdk().messages.create(this.params(messages, opts), { signal: opts?.signal });
      return fromMessage(res);
    } catch (e) {
      throw new AiProviderError(`anthropic: ${(e as Error).message}`, "anthropic", !(e instanceof Anthropic.AuthenticationError));
    }
  }

  async *stream(messages: ChatMessage[], opts?: ChatOptions): AsyncGenerator<StreamEvent, void, void> {
    try {
      const stream = this.sdk().messages.stream(this.params(messages, opts), { signal: opts?.signal });
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield { type: "text", delta: ev.delta.text };
      }
      yield { type: "done", result: fromMessage(await stream.finalMessage()) };
    } catch (e) {
      throw new AiProviderError(`anthropic: ${(e as Error).message}`, "anthropic", !(e instanceof Anthropic.AuthenticationError));
    }
  }
}
