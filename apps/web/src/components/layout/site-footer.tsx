import Link from "next/link";
import { Send, MessageCircle, Mail, ShieldCheck, Zap, Headphones } from "lucide-react";
import { Logo } from "./logo";

const COLUMNS = [
  {
    title: "Каталог",
    links: [
      { href: "/catalog?category=igry", label: "Игры" },
      { href: "/catalog?category=podpiski", label: "Подписки" },
      { href: "/steam", label: "Пополнение Steam" },
      { href: "/catalog?category=podarochnye-karty", label: "Подарочные карты" },
      { href: "/catalog?category=igrovaya-valyuta", label: "Игровая валюта" },
    ],
  },
  {
    title: "Покупателям",
    links: [
      { href: "/info/faq", label: "Вопросы и ответы" },
      { href: "/info/rules", label: "Правила площадки" },
      { href: "/info/guarantees", label: "Гарантии и возвраты" },
      { href: "/account/orders", label: "Мои заказы" },
    ],
  },
  {
    title: "Продавцам",
    links: [
      { href: "/sign-up?seller=1", label: "Стать продавцом" },
      { href: "/seller", label: "Кабинет продавца" },
      { href: "/info/seller-rules", label: "Условия для продавцов" },
      { href: "/info/api", label: "API и MCP" },
    ],
  },
  {
    title: "Документы",
    links: [
      { href: "/info/offer", label: "Публичная оферта" },
      { href: "/info/privacy", label: "Политика конфиденциальности" },
      { href: "/info/contacts", label: "Контакты" },
    ],
  },
];

const PAYMENTS = ["Платёжные карты", "СБП", "Platega", "RollyPay", "Баланс сайта"];

export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-border">
      <div className="container-page py-12">
        <div className="mb-10 grid gap-4 sm:grid-cols-3">
          {[
            { icon: Zap, title: "Мгновенная выдача", text: "Ключи и коды — сразу после оплаты" },
            { icon: ShieldCheck, title: "Гарантия возврата", text: "Спор и возврат при проблеме с товаром" },
            { icon: Headphones, title: "Поддержка 24/7", text: "AI-ассистент и живые модераторы" },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="glass flex items-center gap-4 rounded-2xl p-4">
              <span className="gradient-brand flex size-11 shrink-0 items-center justify-center rounded-xl text-white"><Icon className="size-5" /></span>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-sm text-muted-foreground">{text}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="grid gap-10 lg:grid-cols-[1.3fr_repeat(4,1fr)]">
          <div className="space-y-4">
            <Logo />
            <p className="max-w-xs text-sm text-muted-foreground">Маркетплейс цифровых товаров: игры, подписки, пополнение Steam, подарочные карты и внутриигровая валюта.</p>
            <div className="flex gap-2">
              <a href="https://t.me/asapawge_support" aria-label="Telegram" className="glass flex size-10 items-center justify-center rounded-xl transition hover:text-accent"><Send className="size-4" /></a>
              <a href="https://vk.com/asapawge" aria-label="VK" className="glass flex size-10 items-center justify-center rounded-xl transition hover:text-accent"><MessageCircle className="size-4" /></a>
              <a href="mailto:support@asapawge.gg" aria-label="Email" className="glass flex size-10 items-center justify-center rounded-xl transition hover:text-accent"><Mail className="size-4" /></a>
            </div>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="mb-3 text-sm font-semibold">{col.title}</p>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">{l.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-start justify-between gap-4 border-t border-border pt-6 text-sm text-muted-foreground md:flex-row md:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1">Способы оплаты:</span>
            {PAYMENTS.map((p) => (
              <span key={p} className="glass rounded-lg px-2.5 py-1 text-xs font-medium text-foreground/80">{p}</span>
            ))}
          </div>
          <p>© {new Date().getFullYear()} ASAPawge GG. Все права защищены.</p>
        </div>
      </div>
    </footer>
  );
}
