import { env } from "@/lib/env";
import { OpenAiCompatibleProvider } from "./openai-compatible";

export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o-mini";

/** OpenRouter = OpenAI wire format on another base URL (https://openrouter.ai/api/v1). Key: OPENROUTER_API_KEY. */
export function createOpenRouterProvider() {
  return new OpenAiCompatibleProvider({
    name: "openrouter",
    apiKey: env.ai.openrouterKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: DEFAULT_OPENROUTER_MODEL,
    defaultHeaders: { "HTTP-Referer": env.appUrl, "X-Title": "ASAPawge GG" },
  });
}
