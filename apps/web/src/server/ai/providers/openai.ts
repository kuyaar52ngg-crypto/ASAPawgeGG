import { env } from "@/lib/env";
import { OpenAiCompatibleProvider } from "./openai-compatible";

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

/** OpenAI Chat Completions via the official `openai` SDK. Key: OPENAI_API_KEY. */
export function createOpenAiProvider() {
  return new OpenAiCompatibleProvider({ name: "openai", apiKey: env.ai.openaiKey, defaultModel: DEFAULT_OPENAI_MODEL });
}
