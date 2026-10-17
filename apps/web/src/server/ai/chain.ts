import type { LLMProvider, ProviderName } from "./types";

export interface ChainLink {
  provider: LLMProvider;
  model: string;
}

export interface AiSelection {
  /** value of Setting("ai.provider") ▸ AI_PROVIDER (may be "mock" or a provider that has no key) */
  preferred: string;
  /** value of Setting("ai.model") ▸ AI_MODEL; applies to the preferred provider only */
  model: string;
  configured: Exclude<ProviderName, "mock">[];
}

/**
 * Fallback chain: the selected provider first (when it has a key), then every other configured provider.
 * `withMock` appends the offline provider as the last resort (support chat); tasks pass false and use their own heuristics.
 * An explicit model (Setting ▸ env) is applied to the selected provider only — model ids are provider specific.
 */
export function buildChain(sel: AiSelection, providers: Record<Exclude<ProviderName, "mock">, LLMProvider>, mock: LLMProvider, opts: { withMock: boolean }): ChainLink[] {
  const order: Exclude<ProviderName, "mock">[] = [];
  if ((sel.configured as string[]).includes(sel.preferred)) order.push(sel.preferred as Exclude<ProviderName, "mock">);
  for (const k of sel.configured) if (!order.includes(k)) order.push(k);
  const chain: ChainLink[] = order.map((k) => ({ provider: providers[k], model: k === sel.preferred && sel.model ? sel.model : providers[k].defaultModel() }));
  if (opts.withMock) chain.push({ provider: mock, model: mock.defaultModel() });
  return chain;
}

