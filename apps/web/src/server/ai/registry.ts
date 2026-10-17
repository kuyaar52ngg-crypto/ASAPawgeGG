import "server-only";
import { getSetting } from "@asap/db";
import { SETTING_KEYS } from "@asap/shared";
import { env } from "@/lib/env";
import { AnthropicProvider } from "./providers/anthropic";
import { MockProvider } from "./providers/mock";
import { createOpenAiProvider } from "./providers/openai";
import { createOpenRouterProvider } from "./providers/openrouter";
import { buildChain, type AiSelection, type ChainLink } from "./chain";

export type { AiSelection, ChainLink };
import type { LLMProvider, ProviderName } from "./types";

/** Singleton adapters. Order = default priority among configured providers when nothing is selected explicitly. */
export const PROVIDERS: Record<Exclude<ProviderName, "mock">, LLMProvider> = {
  anthropic: new AnthropicProvider(),
  openai: createOpenAiProvider(),
  openrouter: createOpenRouterProvider(),
};
export const MOCK_PROVIDER = new MockProvider();

async function safeSetting(key: string, fallback: string): Promise<string> {
  try {
    const v = await getSetting<string>(key, fallback);
    return typeof v === "string" ? v : fallback;
  } catch {
    return fallback;
  }
}

export async function getAiSelection(): Promise<AiSelection> {
  const preferred = ((await safeSetting(SETTING_KEYS.aiProvider, env.ai.provider)) || env.ai.provider || "mock").trim().toLowerCase();
  const model = ((await safeSetting(SETTING_KEYS.aiModel, env.ai.model)) || env.ai.model || "").trim();
  const configured = (Object.keys(PROVIDERS) as (keyof typeof PROVIDERS)[]).filter((k) => PROVIDERS[k].isConfigured());
  return { preferred, model, configured };
}

export async function resolveChain(opts: { withMock: boolean }): Promise<ChainLink[]> {
  return buildChain(await getAiSelection(), PROVIDERS, MOCK_PROVIDER, opts);
}
