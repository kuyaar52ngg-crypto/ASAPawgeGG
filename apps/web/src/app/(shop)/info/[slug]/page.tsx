import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, Mail, MessageCircle, Send } from "lucide-react";
import { getSetting } from "@asap/db";
import { SETTING_KEYS } from "@asap/shared";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";
import { FAQ_GROUPS, INFO_BY_SLUG, INFO_NAV, type InfoBlock } from "../content";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

const CONTACTS_META = { title: "Контакты", description: "Связаться с поддержкой ASAPawge GG: Telegram, email, время работы.", updated: "2026-10-01" };

function metaFor(slug: string) {
  if (slug === "contacts") return CONTACTS_META;
  const p = INFO_BY_SLUG.get(slug);
  return p ? { title: p.title, description: p.description, updated: p.updated } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const m = metaFor(slug);
  if (!m) return { title: "Страница не найдена" };
  return { title: m.title, description: m.description, alternates: { canonical: `/info/${slug}` } };
}

function Blocks({ blocks }: { blocks: InfoBlock[] }) {
  return (
    <div className="space-y-4 text-[15px] leading-relaxed text-muted-foreground">
      {blocks.map((b, i) => {
        if (b.type === "h") return <h2 key={i} className="!mt-8 font-display text-lg font-semibold text-foreground first:!mt-0">{b.text}</h2>;
        if (b.type === "p") return <p key={i}>{b.text}</p>;
        if (b.type === "ul")
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5">
              {b.items.map((it) => <li key={it}>{it}</li>)}
            </ul>
          );
        return (
          <ol key={i} className="list-decimal space-y-1.5 pl-5">
            {b.items.map((it) => <li key={it}>{it}</li>)}
          </ol>
        );
      })}
    </div>
  );
}

interface SupportContacts {
  telegram?: string;
  email?: string;
  vk?: string;
}

async function Contacts() {
  const c = await getSetting<SupportContacts>(SETTING_KEYS.supportContacts, {}).catch(() => ({}) as SupportContacts);
  const rows = [
    c.telegram && { icon: Send, label: "Telegram", value: c.telegram.replace(/^https?:\/\//, ""), href: c.telegram },
    c.email && { icon: Mail, label: "Email", value: c.email, href: `mailto:${c.email}` },
    c.vk && { icon: MessageCircle, label: "VK", value: c.vk.replace(/^https?:\/\//, ""), href: c.vk },
  ].filter(Boolean) as { icon: typeof Send; label: string; value: string; href: string }[];
  return (
    <div className="space-y-6">
      <p className="text-[15px] leading-relaxed text-muted-foreground">Мы отвечаем на обращения круглосуточно: сначала подключается ИИ-ассистент, при необходимости — живой модератор. По вопросам заказов приложите номер заказа.</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {rows.map(({ icon: Icon, label, value, href }) => (
          <li key={label}>
            <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer" className="glass glow-hover flex items-center gap-4 rounded-2xl p-4">
              <span className="gradient-brand flex size-12 shrink-0 items-center justify-center rounded-xl text-white">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs text-muted-foreground">{label}</span>
                <span className="block truncate font-semibold">{value}</span>
              </span>
            </a>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-muted-foreground">Контакты поддержки пока не настроены.</li>}
      </ul>
      <div className="glass flex items-start gap-3 rounded-2xl p-4 text-sm">
        <Clock className="mt-0.5 size-4 shrink-0 text-accent" />
        <p className="text-muted-foreground">Поддержка работает 24/7. Обычно мы отвечаем в течение 15 минут. Споры по заказам удобнее открывать прямо в личном кабинете — в разделе «Мои заказы».</p>
      </div>
      <p className="text-sm text-muted-foreground">
        Вопросы о возвратах — на странице <Link href="/info/guarantees" className="text-primary hover:underline">«Гарантии и возвраты»</Link>.
      </p>
    </div>
  );
}

export default async function InfoPage({ params }: Props) {
  const { slug } = await params;
  const meta = metaFor(slug);
  if (!meta) notFound();
  const page = INFO_BY_SLUG.get(slug);

  const faqLd =
    slug === "faq"
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQ_GROUPS.flatMap((g) => g.items).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
        }
      : null;

  return (
    <div className="container-page py-6 sm:py-10">
      {faqLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, "\\u003c") }} />}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <nav aria-label="Информация" className="lg:sticky lg:top-24 lg:self-start">
          <ul className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
            {INFO_NAV.map((n) => (
              <li key={n.slug} className="shrink-0">
                <Link
                  href={`/info/${n.slug}`}
                  aria-current={n.slug === slug ? "page" : undefined}
                  className={cn("block rounded-xl px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors", n.slug === slug ? "gradient-brand text-white" : "glass hover:bg-foreground/10 lg:border-0 lg:bg-transparent lg:backdrop-blur-none")}
                >
                  {n.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <article className="min-w-0">
          <h1 className="text-2xl font-bold sm:text-3xl">{meta.title}</h1>
          <p className="mt-1.5 text-xs text-muted-foreground">Обновлено: {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(meta.updated))}</p>
          <div className="glass mt-6 rounded-3xl p-5 sm:p-8">
            {slug === "contacts" ? (
              <Contacts />
            ) : slug === "faq" ? (
              <div className="space-y-8">
                {FAQ_GROUPS.map((g) => (
                  <section key={g.title}>
                    <h2 className="mb-3 font-display text-lg font-semibold">{g.title}</h2>
                    <Accordion type="single" collapsible>
                      {g.items.map((f, i) => (
                        <AccordionItem key={f.q} value={`${g.title}-${i}`} className="bg-foreground/[0.03]">
                          <AccordionTrigger className="text-[15px]">{f.q}</AccordionTrigger>
                          <AccordionContent className="leading-relaxed">{f.a}</AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </section>
                ))}
                <p className="text-sm text-muted-foreground">
                  Не нашли ответ? Загляните в <Link href="/info/contacts" className="text-primary hover:underline">контакты</Link> — поддержка на связи 24/7.
                </p>
              </div>
            ) : (
              page && <Blocks blocks={page.blocks} />
            )}
          </div>
        </article>
      </div>
    </div>
  );
}
