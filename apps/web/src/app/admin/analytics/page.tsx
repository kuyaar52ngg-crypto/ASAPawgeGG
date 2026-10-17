import Link from "next/link";
import { Activity, Eye, MousePointerClick, Search } from "lucide-react";
import { requireRole } from "@/server/auth/session";
import { PageHeader } from "@/components/layout/dashboard-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterPills, StatTile } from "@/components/admin/common";
import { getTrafficReport } from "@/server/analytics/traffic";
import { parsePeriod } from "@/server/analytics/range";
import { PERIOD_OPTIONS } from "@/server/analytics/types";
import { getSetting } from "@asap/db";
import { SETTING_KEYS } from "@asap/shared";

export const metadata = { title: "Админка · Трафик и события" };
export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("ru-RU");

const EVENT_LABELS: Record<string, string> = {
  page_view: "Просмотры страниц",
  view_item: "Просмотры товаров",
  search: "Поиск",
  add_to_cart: "Добавления в корзину",
  remove_from_cart: "Удаления из корзины",
  begin_checkout: "Начало оформления",
  add_payment_info: "Выбор способа оплаты",
  purchase: "Покупки",
  sign_up: "Регистрации",
  login: "Входы",
  topup_balance: "Пополнения баланса",
  steam_topup_start: "Пополнение Steam",
  favorite_add: "В избранное",
  review_submit: "Отзывы",
  dispute_open: "Споры",
  ai_chat_message: "Сообщения AI-чату",
};

export default async function AdminAnalyticsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireRole("ADMIN");
  const sp = await searchParams;
  const days = parsePeriod(sp.days, 30);
  const [r, ymSetting] = await Promise.all([getTrafficReport(days), getSetting<string | number>(SETTING_KEYS.ymId, "").catch(() => "")]);
  const ymId = String(process.env.NEXT_PUBLIC_YM_ID || ymSetting || "").trim();

  return (
    <>
      <PageHeader title="Трафик и события" description="Собственная аналитика (таблица AnalyticsEvent) и состояние счётчика Яндекс Метрики" />
      <FilterPills active={String(days)} items={PERIOD_OPTIONS.map((d) => ({ key: String(d), label: `${d} дней`, href: `/admin/analytics?days=${d}` }))} />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Событий" value={nf.format(r.totalEvents)} icon={<Activity />} />
        <StatTile label="Сессий" value={nf.format(r.sessions)} icon={<MousePointerClick />} />
        <StatTile label="Просмотров страниц" value={nf.format(r.events.find((e) => e.name === "page_view")?.count ?? 0)} icon={<Eye />} />
        <StatTile label="Поисковых запросов" value={nf.format(r.events.find((e) => e.name === "search")?.count ?? 0)} icon={<Search />} />
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Яндекс Метрика</CardTitle>
          <CardDescription>Счётчик подключается только при заданном ID: переменная NEXT_PUBLIC_YM_ID или настройка в разделе «Настройки»</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 text-sm">
          {ymId ? <Badge variant="success">Подключена · счётчик {ymId}</Badge> : <Badge variant="warning">Не подключена — укажите ID счётчика</Badge>}
          <span className="text-muted-foreground">Включены: Вебвизор, карта кликов, ecommerce (dataLayer), отслеживание ссылок. Цели с теми же идентификаторами, что и события ниже, создаются в интерфейсе Метрики.</span>
          <Link href="/admin/settings" className="text-primary underline underline-offset-4">Открыть настройки</Link>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>События</CardTitle><CardDescription>Количество и уникальные посетители</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Событие</TableHead><TableHead className="text-right">Всего</TableHead><TableHead className="text-right">Уникальных</TableHead></TableRow></TableHeader>
              <TableBody>
                {r.events.map((e) => (
                  <TableRow key={e.name}>
                    <TableCell><span className="font-medium">{EVENT_LABELS[e.name] ?? e.name}</span> <code className="ml-1 text-xs text-muted-foreground">{e.name}</code></TableCell>
                    <TableCell className="text-right tabular-nums">{nf.format(e.count)}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{nf.format(e.uniques)}</TableCell>
                  </TableRow>
                ))}
                {r.events.length === 0 && <TableRow><TableCell colSpan={3} className="py-8 text-center text-muted-foreground">Нет событий за период</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader><CardTitle>Популярные страницы</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader><TableRow><TableHead>Путь</TableHead><TableHead className="text-right">Просмотров</TableHead></TableRow></TableHeader>
                <TableBody>
                  {r.topPages.map((p) => (
                    <TableRow key={p.path}><TableCell className="max-w-72 truncate font-mono text-xs">{p.path}</TableCell><TableCell className="text-right tabular-nums">{nf.format(p.views)}</TableCell></TableRow>
                  ))}
                  {r.topPages.length === 0 && <TableRow><TableCell colSpan={2} className="py-6 text-center text-muted-foreground">Нет данных</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Источники трафика</CardTitle><CardDescription>По домену реферера</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {r.topReferrers.map((p) => (
                    <TableRow key={p.referrer}><TableCell>{p.referrer}</TableCell><TableCell className="text-right tabular-nums">{nf.format(p.visits)}</TableCell></TableRow>
                  ))}
                  {r.topReferrers.length === 0 && <TableRow><TableCell className="py-6 text-center text-muted-foreground">Нет данных</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Что ищут</CardTitle><CardDescription>Топ поисковых запросов</CardDescription></CardHeader>
            <CardContent>
              <Table>
                <TableBody>
                  {r.topSearches.map((p) => (
                    <TableRow key={p.q}><TableCell>{p.q}</TableCell><TableCell className="text-right tabular-nums">{nf.format(p.count)}</TableCell></TableRow>
                  ))}
                  {r.topSearches.length === 0 && <TableRow><TableCell className="py-6 text-center text-muted-foreground">Нет данных</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
