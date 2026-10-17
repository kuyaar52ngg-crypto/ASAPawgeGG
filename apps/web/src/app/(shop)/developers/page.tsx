import type { Metadata } from "next";
import Link from "next/link";
import { Bot, KeyRound, Plug, Webhook } from "lucide-react";
import { API_SCOPES, ROLE_SCOPES } from "@asap/shared";
import { Badge } from "@/components/ui/badge";
import { ClientTabs, type ClientSnippet } from "@/components/developers/client-tabs";
import { CodeBlock } from "@/components/developers/code-block";
import { buildOpenApi } from "@/server/api-v1/openapi";
import { baseUrl } from "@/server/api-v1/http";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "API и MCP для разработчиков",
  description: "REST API v1 и MCP-сервер ASAPawge GG: ключи, права доступа, примеры запросов и подключение к Claude, Cursor и другим AI-агентам.",
  alternates: { canonical: "/developers" },
};

const SCOPE_DESC: Record<string, string> = {
  "catalog:read": "Каталог, категории, карточки товаров",
  "orders:read": "Свои заказы, выданные ключи, баланс",
  "orders:create": "Покупка с баланса сайта",
  "seller:products": "Создание товаров (продавец)",
  "seller:stock": "Загрузка ключей на склад (продавец)",
  "seller:stats": "Статистика продаж (продавец)",
  "admin:metrics": "Метрики площадки (администратор)",
  "admin:moderate": "Модерация товаров (администратор)",
};

const MCP_TOOLS: { name: string; scope: string; desc: string }[] = [
  { name: "search_products", scope: "catalog:read", desc: "Поиск товаров по названию, цене, платформе" },
  { name: "get_product", scope: "catalog:read", desc: "Карточка товара с вариантами и наличием" },
  { name: "list_categories", scope: "catalog:read", desc: "Дерево категорий" },
  { name: "create_order", scope: "orders:create", desc: "Купить товары с баланса и получить ключи" },
  { name: "get_order_status", scope: "orders:read", desc: "Статус заказа и выданное содержимое" },
  { name: "list_my_orders", scope: "orders:read", desc: "Список моих заказов" },
  { name: "get_balance", scope: "orders:read", desc: "Баланс сайта" },
  { name: "seller_create_product", scope: "seller:products", desc: "Создать товар (черновик или на модерацию)" },
  { name: "seller_upload_stock", scope: "seller:stock", desc: "Загрузить ключи на склад товара" },
  { name: "seller_stats", scope: "seller:stats", desc: "Продажи, баланс, что требует внимания" },
  { name: "admin_metrics", scope: "admin:metrics", desc: "Метрики панели администратора" },
  { name: "admin_moderate_product", scope: "admin:moderate", desc: "Опубликовать / отклонить / архивировать товар" },
];

function Section({ id, icon, title, children }: { id: string; icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 space-y-4">
      <h2 className="flex items-center gap-3 font-display text-xl font-semibold">
        <span className="grid size-9 place-items-center rounded-xl bg-primary/15 text-primary">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function DevelopersPage() {
  const app = baseUrl();
  const api = `${app}/api/v1`;
  const mcpUrl = process.env.MCP_PUBLIC_URL ?? "http://localhost:3333/mcp";
  const spec = buildOpenApi(app);
  const endpoints = Object.entries(spec.paths).flatMap(([path, ops]) =>
    Object.entries(ops as Record<string, { summary: string; security?: { BearerAuth?: string[] }[] }>).map(([method, op]) => ({ method: method.toUpperCase(), path, summary: op.summary, scope: op.security?.find((s) => s.BearerAuth)?.BearerAuth?.[0] ?? null })),
  );

  const curl = `curl -s ${api}/products?q=spotify \\
  -H "Authorization: Bearer ak_live_ВАШ_КЛЮЧ"

# купить с баланса (повторный запрос с тем же Idempotency-Key безопасен)
curl -s -X POST ${api}/orders \\
  -H "Authorization: Bearer ak_live_ВАШ_КЛЮЧ" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -d '{"items":[{"productId":"ID_ТОВАРА","variantId":"ID_ВАРИАНТА","quantity":1}]}'`;

  const snippets: ClientSnippet[] = [
    {
      id: "claude-code",
      label: "Claude Code",
      lang: "bash",
      hint: "Подключение по HTTP одной командой. Ключ передаётся заголовком.",
      code: `claude mcp add --transport http asapawge ${mcpUrl} \\\n  --header "Authorization: Bearer ak_live_ВАШ_КЛЮЧ"`,
    },
    {
      id: "claude-desktop",
      label: "Claude Desktop",
      lang: "claude_desktop_config.json",
      hint: "Через stdio: соберите MCP-сервер (pnpm --filter @asap/mcp build) и укажите путь к dist/stdio.js. Ключ — в переменной окружения.",
      code: JSON.stringify({ mcpServers: { asapawge: { command: "node", args: ["/путь/к/ASAPawgeGG/apps/mcp/dist/stdio.js"], env: { ASAP_API_KEY: "ak_live_ВАШ_КЛЮЧ", APP_URL: app } } } }, null, 2),
    },
    {
      id: "cursor",
      label: "Cursor",
      lang: ".cursor/mcp.json",
      hint: "Файл .cursor/mcp.json в проекте или ~/.cursor/mcp.json глобально. Транспорт — Streamable HTTP.",
      code: JSON.stringify({ mcpServers: { asapawge: { url: mcpUrl, headers: { Authorization: "Bearer ak_live_ВАШ_КЛЮЧ" } } } }, null, 2),
    },
    {
      id: "generic",
      label: "Другой клиент",
      lang: "http",
      hint: "Любой клиент с поддержкой Streamable HTTP: POST на адрес сервера с заголовком Authorization. Для клиентов только со stdio используйте npx mcp-remote.",
      code: `POST ${mcpUrl}\nAuthorization: Bearer ak_live_ВАШ_КЛЮЧ\nContent-Type: application/json\nAccept: application/json, text/event-stream\n\n# или через мост:\nnpx mcp-remote ${mcpUrl} --header "Authorization: Bearer ak_live_ВАШ_КЛЮЧ"`,
    },
  ];

  return (
    <div className="container-page py-10">
      <header className="mb-10 max-w-3xl space-y-3">
        <Badge variant="secondary">Для разработчиков</Badge>
        <h1 className="font-display text-3xl font-bold sm:text-4xl">API и MCP</h1>
        <p className="text-muted-foreground">
          Автоматизируйте покупки и продажи: REST API v1 для интеграций и MCP-сервер для AI-агентов (Claude, Cursor и др.). Оба работают по одному API-ключу и одним правам доступа.
        </p>
        <nav className="flex flex-wrap gap-2 pt-1 text-sm">
          {[["#keys", "Ключи"], ["#rest", "REST API"], ["#endpoints", "Методы"], ["#mcp", "MCP"], ["#errors", "Ошибки и лимиты"]].map(([href, label]) => (
            <a key={href} href={href} className="rounded-full border border-border px-3 py-1 hover:border-primary/60 hover:bg-primary/10">{label}</a>
          ))}
          <Link href="/api/v1/openapi.json" className="rounded-full border border-border px-3 py-1 hover:border-primary/60 hover:bg-primary/10">openapi.json</Link>
        </nav>
      </header>

      <div className="max-w-4xl space-y-14">
        <Section id="keys" icon={<KeyRound className="size-5" />} title="API-ключи и права">
          <p className="text-muted-foreground">
            Ключ создаётся в личном кабинете: <Link href="/account/api-keys" className="text-primary underline underline-offset-2">покупатель</Link> или <Link href="/seller/api-keys" className="text-primary underline underline-offset-2">продавец</Link> → «API-ключи». Полный ключ показывается один раз (<code>ak_live_…</code>), мы храним только его хэш. Передавайте его заголовком <code>Authorization: Bearer …</code> (или <code>X-API-Key</code>).
          </p>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-2.5">Право (scope)</th><th className="px-4 py-2.5">Что даёт</th><th className="px-4 py-2.5">Доступно ролям</th></tr>
              </thead>
              <tbody>
                {API_SCOPES.map((s) => (
                  <tr key={s} className="border-t border-border">
                    <td className="px-4 py-2.5 font-mono text-[13px]">{s}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{SCOPE_DESC[s]}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{(["USER", "SELLER", "ADMIN"] as const).filter((r) => (ROLE_SCOPES[r] as readonly string[]).includes(s)).join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">Итоговая роль ключа — меньшая из роли ключа и текущей роли владельца. Заблокированный аккаунт и отозванный ключ перестают работать немедленно.</p>
        </Section>

        <Section id="rest" icon={<Webhook className="size-5" />} title="REST API v1">
          <p className="text-muted-foreground">
            Базовый адрес: <code>{api}</code>. Суммы — целые числа в <b>копейках</b>. Ответ: <code>{"{ ok: true, data }"}</code> или <code>{"{ ok: false, error: { code, message } }"}</code>. Спецификация OpenAPI 3.1: <Link href="/api/v1/openapi.json" className="text-primary underline underline-offset-2">/api/v1/openapi.json</Link>.
          </p>
          <CodeBlock code={curl} lang="bash" />
          <p className="text-sm text-muted-foreground">Покупка через API оплачивается с баланса сайта; пополнить его можно в <Link href="/account/topup" className="text-primary underline underline-offset-2">личном кабинете</Link>. Если выдача завершилась за несколько секунд, ключи придут прямо в ответе <code>POST /orders</code>, иначе забирайте их через <code>GET /orders/{"{id}"}</code>.</p>
        </Section>

        <Section id="endpoints" icon={<Plug className="size-5" />} title="Методы">
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-2.5">Метод</th><th className="px-4 py-2.5">Путь</th><th className="px-4 py-2.5">Описание</th><th className="px-4 py-2.5">Право</th></tr>
              </thead>
              <tbody>
                {endpoints.map((e) => (
                  <tr key={e.method + e.path} className="border-t border-border align-top">
                    <td className="px-4 py-2.5"><Badge variant={e.method === "GET" ? "secondary" : "default"}>{e.method}</Badge></td>
                    <td className="px-4 py-2.5 font-mono text-[13px]">{e.path}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{e.summary}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{e.scope ?? "любой ключ"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="mcp" icon={<Bot className="size-5" />} title="MCP-сервер для AI-агентов">
          <p className="text-muted-foreground">
            MCP (Model Context Protocol) позволяет AI-ассистенту искать товары, покупать и управлять магазином от вашего имени. Сервер — тонкий клиент REST API: те же ключи, права и лимиты. Набор инструментов зависит от прав ключа (роль и scope). Адрес сервера: <code>{mcpUrl}</code>.
          </p>
          <ClientTabs snippets={snippets} />
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="px-4 py-2.5">Инструмент</th><th className="px-4 py-2.5">Описание</th><th className="px-4 py-2.5">Право</th></tr>
              </thead>
              <tbody>
                {MCP_TOOLS.map((t) => (
                  <tr key={t.name} className="border-t border-border">
                    <td className="px-4 py-2.5 font-mono text-[13px]">{t.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{t.desc}</td>
                    <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{t.scope}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-muted-foreground">Дополнительно: ресурс <code>asapawge://categories</code> (каталог категорий) и подсказка <code>buy-assistant</code> — готовый сценарий «подобрать и купить».</p>
        </Section>

        <Section id="errors" icon={<Webhook className="size-5" />} title="Ошибки и лимиты">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li><code>401</code> — нет, неверный, отозванный или просроченный ключ; <code>403</code> — не хватает права или роли; <code>404</code> — не найдено; <code>422</code> — ошибка валидации (детали в <code>error.details</code>).</li>
            <li><code>402 insufficient_funds</code> — недостаточно средств на балансе; <code>409</code> — товара нет в наличии.</li>
            <li><code>429</code> — лимит 120 запросов в минуту на ключ (и 30 заказов в час); заголовок <code>Retry-After</code> подскажет, когда повторить. Остаток — в <code>X-RateLimit-Remaining</code>.</li>
            <li>Ключи и данные доступа конфиденциальны: не публикуйте их в логах и репозиториях. При утечке отзовите ключ в кабинете.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
