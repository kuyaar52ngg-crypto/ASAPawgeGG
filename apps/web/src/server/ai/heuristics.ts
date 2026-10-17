import { PRODUCT_TYPE_LABELS, PLATFORMS, REGIONS } from "@asap/shared";

/** Offline (rule-based) fallbacks used when no LLM provider is configured or every provider failed. Pure functions, unit-tested. */

export interface DescribeInput {
  title: string;
  type: string;
  deliveryMode: string;
  platform?: string | null;
  region?: string | null;
  categoryName?: string | null;
  notes?: string | null;
}

export interface DescribeOutput {
  description: string;
  shortDescription: string;
  tags: string[];
}

const labelOf = (list: readonly { value: string; label: string }[], v?: string | null) => (v ? (list.find((x) => x.value === v)?.label ?? v) : null);

const DELIVERY_TEXT: Record<string, string> = {
  AUTO_STOCK: "Выдача автоматическая: данные для активации появятся в личном кабинете сразу после оплаты, 24/7.",
  AUTO_PROVIDER: "Выдача автоматическая через поставщика: обычно занимает от 1 до 5 минут после оплаты.",
  MANUAL: "Выдача вручную: продавец выполнит заказ в течение нескольких минут после оплаты — статус виден в личном кабинете.",
};

export function templateDescription(i: DescribeInput): DescribeOutput {
  const typeLabel = (PRODUCT_TYPE_LABELS as Record<string, string>)[i.type] ?? i.type;
  const platform = labelOf(PLATFORMS, i.platform);
  const region = labelOf(REGIONS, i.region);
  const facts = [platform ? `Платформа: ${platform}` : null, region ? `Регион активации: ${region}` : null, `Тип товара: ${typeLabel}`].filter(Boolean) as string[];
  const parts = [
    `${i.title} — ${typeLabel.toLowerCase()}${platform ? ` для ${platform}` : ""}${i.categoryName ? ` из категории «${i.categoryName}»` : ""}.`,
    facts.join(". ") + ".",
    DELIVERY_TEXT[i.deliveryMode] ?? DELIVERY_TEXT.MANUAL!,
    i.notes?.trim() ? i.notes.trim().slice(0, 600) : null,
    "Перед покупкой проверьте регион и платформу. Если возникнут вопросы, напишите продавцу в чате заказа; при проблемах с выдачей можно открыть спор — площадка защищает покупателя.",
  ].filter(Boolean) as string[];
  const tags = [...new Set([i.title.toLowerCase(), platform?.toLowerCase(), region?.toLowerCase(), typeLabel.toLowerCase(), i.categoryName?.toLowerCase()].filter((t): t is string => Boolean(t) && (t as string).length <= 40))].slice(0, 8);
  return { description: parts.join("\n\n"), shortDescription: `${typeLabel}${platform ? ` · ${platform}` : ""}${region ? ` · ${region}` : ""}. ${i.deliveryMode === "MANUAL" ? "Выдача продавцом." : "Мгновенная выдача."}`.slice(0, 240), tags };
}

export interface ModerationInput {
  title: string;
  description: string;
  price: number;
  imagesCount?: number;
  type?: string;
}

export interface ModerationVerdict {
  score: number;
  verdict: "approve" | "review" | "reject";
  reasons: string[];
}

const FORBIDDEN = [
  { re: /(краден|ворован|carding|кардинг|фишинг|взломанн|читы? для|накрутк|дудос|ddos|нелегал)/iu, reason: "Запрещённый или сомнительный товар", penalty: 70 },
  { re: /(взломан|crack(?:ed)?\b|кряк|ломан\p{L}*)/iu, reason: "Признаки пиратского ПО", penalty: 60 },
  { re: /(t\.me\/|telegram\.me|whatsapp|@\w{4,}|\+7\d{10}|\b8\d{10}\b)/iu, reason: "Контакты вне площадки — общение только в чате заказа", penalty: 35 },
  { re: /(https?:\/\/(?!picsum|placehold|images\.unsplash))\S+/iu, reason: "Сторонние ссылки в описании", penalty: 20 },
];

export function ruleBasedModeration(p: ModerationInput): ModerationVerdict {
  let score = 100;
  const reasons: string[] = [];
  const text = `${p.title}\n${p.description}`;
  for (const f of FORBIDDEN) {
    if (f.re.test(text)) {
      score -= f.penalty;
      reasons.push(f.reason);
    }
  }
  if (p.description.trim().length < 80) {
    score -= 20;
    reasons.push("Слишком короткое описание");
  }
  if (p.title.length < 8) {
    score -= 10;
    reasons.push("Слишком короткое название");
  }
  if (p.title === p.title.toUpperCase() && /[A-ZА-ЯЁ]{6,}/u.test(p.title)) {
    score -= 10;
    reasons.push("Название написано заглавными буквами");
  }
  if ((p.imagesCount ?? 0) === 0) {
    score -= 10;
    reasons.push("Нет изображения");
  }
  if (p.price < 1000) {
    score -= 15;
    reasons.push("Подозрительно низкая цена");
  }
  score = Math.max(0, Math.min(100, score));
  const hard = reasons.some((r) => r.startsWith("Запрещённый") || r.startsWith("Признаки пиратского"));
  const verdict = hard || score < 40 ? "reject" : score >= 80 ? "approve" : "review";
  return { score, verdict, reasons: reasons.length ? reasons : ["Нарушений не найдено"] };
}
