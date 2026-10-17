import type { ChatMessage, ChatOptions, ChatResult, LLMProvider, StreamEvent, ToolCall } from "../types";

/**
 * Deterministic OFFLINE provider (no network, no key). It is an intent router + template renderer, not a language model:
 * it picks one of the offered tools from keywords of the last user message, then renders the tool result as Russian text.
 * Used as the last link of the fallback chain for the support chat, so the whole flow stays testable without API keys.
 * Everything it produces is flagged `mock: true` and labelled in the UI.
 */

const ORDER_RE = /AG-\d{6}-[A-Z0-9]{4}/i;
const HUMAN_RE = /(оператор|человек|менеджер|жалоб|претензи|свяж\p{L}+ с (?:поддержк|админ)|передай\p{L}* (?:админ|поддержк)|не помог)/iu;
const ORDER_RE_WORDS = /(мой заказ|заказ|статус|оплатил|не пришл|не получил|где (?:мой )?(?:ключ|товар))/iu;
const FAQ_STRONG_RE = /(вернуть|возврат|гарант|безопас|комисси|продавать|промокод|спор(?![\p{L}])|api|апи|доставк|выдач|способ\p{L}* оплат|как оплат|как купит)/iu;
const QUESTION_RE = /^(как|где|почему|можно ли|что такое|зачем|когда)(?![\p{L}])/iu;
const STOP = new Set(["найди", "найти", "покажи", "хочу", "купить", "нужен", "нужна", "нужно", "есть", "ли", "у", "вас", "мне", "для", "на", "в", "по", "подскажи", "посоветуй", "пожалуйста", "что", "почем", "цена", "стоимость", "сколько", "стоит"]);

function lastUser(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "user") return m.content;
  }
  return "";
}

function hasTool(opts: ChatOptions | undefined, name: string): boolean {
  return Boolean(opts?.tools?.some((t) => t.name === name));
}

function call(name: string, args: Record<string, unknown>, n: number): ToolCall {
  return { id: `mock_${n}_${name}`, name, arguments: args };
}

function searchQuery(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s+.-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .join(" ")
    .trim();
}

function rub(k: unknown): string {
  const n = Number(k);
  if (!Number.isFinite(n)) return "";
  const v = n / 100;
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(v)} ₽`;
}

function parse(content: string): Record<string, unknown> {
  try {
    const v = JSON.parse(content) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Renders tool results (the tail of `messages`) as the final assistant answer. */
function renderFromTools(messages: ChatMessage[]): string {
  const tail: Extract<ChatMessage, { role: "tool" }>[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "tool") break;
    tail.unshift(m);
  }
  const parts: string[] = [];
  for (const t of tail) {
    const d = parse(t.content);
    if (typeof d.error === "string") {
      parts.push(String(d.error));
      continue;
    }
    if (t.name === "search_products") {
      const items = (d.products as { title: string; price: number; url: string; inStock: boolean }[] | undefined) ?? [];
      if (!items.length) parts.push("По вашему запросу ничего не нашлось. Попробуйте переформулировать или загляните в каталог.");
      else parts.push("Вот что нашлось:\n" + items.slice(0, 5).map((p) => `• ${p.title} — от ${rub(p.price)}${p.inStock ? "" : " (нет в наличии)"} — ${p.url}`).join("\n"));
    } else if (t.name === "get_order_status") {
      const orders = (d.orders as { number: string; status: string; statusLabel: string; total: number; items: string[]; link: string }[] | undefined) ?? [];
      if (!orders.length) parts.push("Я не нашёл заказов на вашем аккаунте. Проверьте номер заказа (формат AG-250101-AB12).");
      else parts.push(orders.map((o) => `Заказ ${o.number}: ${o.statusLabel}. Сумма ${rub(o.total)}. Товары: ${o.items.join(", ")}. Подробнее: ${o.link}`).join("\n"));
    } else if (t.name === "get_faq") {
      const items = (d.items as { q: string; a: string }[] | undefined) ?? [];
      if (!items.length) parts.push("В базе знаний нет точного ответа. Могу передать вопрос администратору — напишите «позовите оператора».");
      else parts.push(items.slice(0, 2).map((i) => `${i.q}\n${i.a}`).join("\n\n"));
    } else if (t.name === "create_support_ticket") {
      parts.push(`Я передал обращение администраторам${d.ticketId ? ` (№ ${String(d.ticketId).slice(-8)})` : ""}. Ответ придёт в уведомлениях личного кабинета${d.link ? ` — ${String(d.link)}` : ""}.`);
    } else parts.push(t.content.slice(0, 300));
  }
  return parts.join("\n\n") || "Готово.";
}

function decide(messages: ChatMessage[], opts: ChatOptions | undefined): ToolCall[] | string {
  const text = lastUser(messages).trim();
  if (!text) return "Здравствуйте! Я помощник ASAPawge GG. Могу подобрать товар, проверить статус заказа или ответить на вопросы о покупке.";
  const orderNo = text.match(ORDER_RE)?.[0]?.toUpperCase();
  if (hasTool(opts, "create_support_ticket") && HUMAN_RE.test(text))
    return [call("create_support_ticket", { subject: "Обращение из чата поддержки", message: text.slice(0, 1500), ...(orderNo ? { orderNumber: orderNo } : {}) }, 1)];
  if (hasTool(opts, "get_order_status") && (orderNo || ORDER_RE_WORDS.test(text))) return [call("get_order_status", orderNo ? { orderNumber: orderNo } : {}, 1)];
  if (hasTool(opts, "get_faq") && (FAQ_STRONG_RE.test(text) || QUESTION_RE.test(text))) return [call("get_faq", { query: text.slice(0, 200) }, 1)];
  if (hasTool(opts, "search_products")) {
    const q = searchQuery(text);
    if (q.length >= 2) return [call("search_products", { query: q }, 1)];
  }
  if (hasTool(opts, "get_faq")) return [call("get_faq", { query: text.slice(0, 200) }, 1)];
  return "Не совсем понял вопрос. Опишите, что вы ищете, или назовите номер заказа.";
}

export class MockProvider implements LLMProvider {
  readonly name = "mock" as const;

  isConfigured(): boolean {
    return true;
  }

  defaultModel(): string {
    return "rule-based";
  }

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<ChatResult> {
    const base = { provider: "mock" as const, model: "rule-based", usage: { tokensIn: 0, tokensOut: 0 } };
    const last = messages[messages.length - 1];
    if (last?.role === "tool") return { ...base, content: renderFromTools(messages), toolCalls: [], stopReason: "end" };
    const d = decide(messages, opts);
    if (typeof d === "string") return { ...base, content: d, toolCalls: [], stopReason: "end" };
    return { ...base, content: "", toolCalls: d, stopReason: "tool_calls" };
  }

  async *stream(messages: ChatMessage[], opts?: ChatOptions): AsyncGenerator<StreamEvent, void, void> {
    const result = await this.chat(messages, opts);
    for (const piece of result.content.match(/\S+\s*|\s+/g) ?? []) yield { type: "text", delta: piece };
    yield { type: "done", result };
  }
}
