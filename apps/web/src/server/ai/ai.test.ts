import { describe, expect, it } from "vitest";
import { buildChain } from "./chain";
import { ruleBasedModeration, templateDescription } from "./heuristics";
import { toAnthropicMessages, DEFAULT_ANTHROPIC_MODEL } from "./providers/anthropic";
import type { ChatMessage, LLMProvider, ProviderName } from "./types";

const fake = (name: ProviderName, model: string): LLMProvider => ({
  name,
  isConfigured: () => true,
  defaultModel: () => model,
  chat: async () => {
    throw new Error("not used");
  },
  stream: async function* () {
    throw new Error("not used");
  },
});
const providers = { openai: fake("openai", "o-default"), anthropic: fake("anthropic", "a-default"), openrouter: fake("openrouter", "r-default") };
const mock = fake("mock", "mock-1");

describe("buildChain", () => {
  it("puts the selected provider first and applies the model only to it", () => {
    const chain = buildChain({ preferred: "openai", model: "gpt-x", configured: ["anthropic", "openai"] }, providers, mock, { withMock: false });
    expect(chain.map((c) => [c.provider.name, c.model])).toEqual([["openai", "gpt-x"], ["anthropic", "a-default"]]);
  });

  it("skips an unconfigured preferred provider and appends mock as last resort", () => {
    const chain = buildChain({ preferred: "openrouter", model: "m", configured: ["anthropic"] }, providers, mock, { withMock: true });
    expect(chain.map((c) => c.provider.name)).toEqual(["anthropic", "mock"]);
    expect(chain[0]!.model).toBe("a-default");
  });

  it("is empty with no keys and no mock (tasks then use heuristics)", () => {
    expect(buildChain({ preferred: "mock", model: "", configured: [] }, providers, mock, { withMock: false })).toEqual([]);
  });
});

describe("anthropic message mapping", () => {
  it("defaults to claude-sonnet-5-5", () => {
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
  });

  it("extracts system, merges tool results into user turns", () => {
    const msgs: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "где мой заказ?" },
      { role: "assistant", content: "", toolCalls: [{ id: "t1", name: "get_order_status", arguments: { number: "AG-1" } }] },
      { role: "tool", toolCallId: "t1", name: "get_order_status", content: "{}" },
    ];
    const out = toAnthropicMessages(msgs);
    expect(out.system).toBe("sys");
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    const last = out.messages[2]!.content as { type: string }[];
    expect(last[0]!.type).toBe("tool_result");
  });
});

describe("offline heuristics", () => {
  it("builds a Russian description without an LLM", () => {
    const d = templateDescription({ title: "Spotify Premium 3 месяца", type: "SUBSCRIPTION", deliveryMode: "AUTO_STOCK", platform: "OTHER", region: "GLOBAL" });
    expect(d.description).toContain("Spotify Premium 3 месяца");
    expect(d.description.length).toBeGreaterThan(80);
    expect(d.tags.length).toBeGreaterThan(0);
  });

  it("rejects obviously forbidden listings and approves normal ones", () => {
    const bad = ruleBasedModeration({ title: "Краденые аккаунты", description: "ворованные аккаунты с чужих карт, фишинг", price: 100 });
    expect(bad.verdict).not.toBe("approve");
    const good = ruleBasedModeration({ title: "Ключ Cyberpunk 2077 Steam", description: "Лицензионный ключ для активации в Steam. Выдача автоматически после оплаты, регион Россия и СНГ.", price: 199900, imagesCount: 1 });
    expect(good.verdict).toBe("approve");
  });
});
