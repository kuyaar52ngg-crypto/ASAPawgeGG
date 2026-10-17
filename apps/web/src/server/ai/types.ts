/**
 * Provider-agnostic LLM types (CONTRACTS §12 / 20-F). Plain data only, so every adapter
 * (OpenAI, Anthropic, OpenRouter, mock) can be swapped without touching the tasks.
 */

export type ProviderName = "openai" | "anthropic" | "openrouter" | "mock";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

/** JSON-schema based tool definition (OpenAI "function" / Anthropic "tool" both derive from it). */
export interface ToolDef {
  name: string;
  description: string;
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDef[];
  /** ask for a JSON object answer (best effort; callers still validate with zod) */
  json?: boolean;
  signal?: AbortSignal;
}

export interface ChatUsage {
  tokensIn: number;
  tokensOut: number;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
  usage: ChatUsage;
  provider: ProviderName;
  model: string;
  stopReason: "end" | "tool_calls" | "length" | "other";
}

export type StreamEvent = { type: "text"; delta: string } | { type: "done"; result: ChatResult };

export interface LLMProvider {
  readonly name: ProviderName;
  /** false => the adapter needs a key that is absent (the registry skips it) */
  isConfigured(): boolean;
  defaultModel(): string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult>;
  /** Streams text deltas, then one `done` event carrying the full result (incl. tool calls). */
  stream(messages: ChatMessage[], opts?: ChatOptions): AsyncGenerator<StreamEvent, void, void>;
}

export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly provider: ProviderName,
    public readonly retryable = true,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

/** Where a result came from — returned by tasks so the UI can label offline/demo output. */
export interface AiMeta {
  provider: ProviderName;
  model: string;
  /** true when no real LLM answered (offline heuristics / mock provider) */
  mock: boolean;
}
