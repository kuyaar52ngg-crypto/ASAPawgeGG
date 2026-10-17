import type { Metadata } from "next";
import Link from "next/link";
import { Clock, KeyRound, ShieldCheck, Wallet } from "lucide-react";
import { env } from "@/lib/env";
import { getSteamConfig } from "@/server/catalog/steam";
import { SteamForm } from "@/components/shop/steam-form";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { STEAM_TOPUP_MAX_KOPECKS, STEAM_TOPUP_MIN_KOPECKS, formatRub } from "@asap/shared";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Пополнение Steam — кошелёк по логину за пару минут",
  description: "Пополнить Steam без пароля: введите логин и сумму, оплатите картой или СБП. Рубли и тенге, прозрачная комиссия, автоматическое зачисление.",
  alternates: { canonical: "/steam" },
};

const FAQ = [
  { q: "Нужен ли пароль от аккаунта?", a: "Нет. Для пополнения нужен только логин Steam — тот, что вы вводите при входе. Пароль и коды Steam Guard мы никогда не просим." },
  { q: "Как узнать свой логин Steam?", a: "Откройте клиент Steam → Настройки → Аккаунт: логин отображается в поле «Имя аккаунта». Это не email и не никнейм в профиле." },
  { q: "Сколько времени занимает пополнение?", a: "Обычно 1–5 минут. Статус заказа виден в личном кабинете. Если пополнение задерживается, напишите в поддержку — разберёмся." },
  { q: "Что если я указал неверный логин?", a: "Мы проверяем существование логина до оплаты. Если вы ошиблись, но аккаунт существует, деньги уйдут на него — исправить это после оплаты нельзя, поэтому проверяйте логин внимательно." },
  { q: "Какая комиссия?", a: "Комиссия сервиса показана в калькуляторе до оплаты. Дополнительных платежей и скрытых наценок нет." },
  { q: "Можно ли пополнять кошелёк в долларах?", a: "Пополнение по логину доступно для кошельков в рублях и тенге. Для USD-аккаунтов используйте подарочные карты Steam из каталога." },
];

export default async function SteamPage({ searchParams }: { searchParams: Promise<{ amount?: string }> }) {
  const [cfg, sp] = await Promise.all([getSteamConfig(), searchParams]);
  const requested = Number.parseInt(sp.amount ?? "", 10);
  const initialAmount = Number.isFinite(requested) && requested * 100 >= STEAM_TOPUP_MIN_KOPECKS && requested * 100 <= STEAM_TOPUP_MAX_KOPECKS ? requested : undefined;

  const strip = (t: typeof cfg.rub) => (t ? { currency: t.currency, customAllowed: t.customAllowed, presets: t.presets } : null);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    <div className="container-page py-6 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Хлебные крошки" className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/" className="hover:text-foreground">Главная</Link>
        <span aria-hidden>/</span>
        <span className="text-foreground" aria-current="page">Пополнение Steam</span>
      </nav>

      <div className="mb-8 max-w-3xl">
        <span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-accent/15 px-3 py-1 text-xs font-semibold text-accent">
          <Wallet className="size-3.5" /> Пополнение кошелька
        </span>
        <h1 className="text-3xl leading-tight font-bold sm:text-4xl">
          Пополнение Steam <span className="gradient-brand-text">по логину</span>
        </h1>
        <p className="mt-3 text-muted-foreground">
          Введите логин, выберите сумму от {formatRub(STEAM_TOPUP_MIN_KOPECKS)} до {formatRub(STEAM_TOPUP_MAX_KOPECKS)} и оплатите. Деньги зачисляются автоматически, пароль не нужен.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <SteamForm feePercent={cfg.feePercent} rub={strip(cfg.rub)} kzt={strip(cfg.kzt)} initialAmount={initialAmount} sandbox={env.steamTopup.provider !== "http"} />

        <aside className="space-y-4">
          <ul className="space-y-3">
            {[
              { icon: KeyRound, title: "Только логин", text: "Пароль и Steam Guard не требуются" },
              { icon: Clock, title: "1–5 минут", text: "Автоматическое зачисление на кошелёк" },
              { icon: ShieldCheck, title: "Защита сделки", text: "Спор и возврат на баланс, если что-то пошло не так" },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="glass flex items-center gap-4 rounded-2xl p-4">
                <span className="gradient-brand flex size-11 shrink-0 items-center justify-center rounded-xl text-white">
                  <Icon className="size-5" />
                </span>
                <div>
                  <p className="font-semibold">{title}</p>
                  <p className="text-sm text-muted-foreground">{text}</p>
                </div>
              </li>
            ))}
          </ul>

          <div>
            <h2 className="mb-3 text-lg font-bold">Частые вопросы</h2>
            <Accordion type="single" collapsible>
              {FAQ.map((f, i) => (
                <AccordionItem key={f.q} value={`q${i}`}>
                  <AccordionTrigger className="text-sm">{f.q}</AccordionTrigger>
                  <AccordionContent>{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </aside>
      </div>
    </div>
  );
}
