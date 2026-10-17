# ASAPawge GG

Маркетплейс цифровых товаров (вдохновлён ggsel.net и igm.gg): ключи игр, подписки (Spotify, Netflix, ChatGPT Plus, Game Pass, PS Plus, Discord Nitro…), пополнение Steam, подарочные карты и внутриигровая валюта. Роли: покупатель, продавец, администратор. Автовыдача, AI-модерация, REST API и MCP-сервер для подключения агентов, аналитика + Яндекс Метрика.

## Состав монорепозитория (pnpm workspaces)

| Путь | Что это |
|---|---|
| `apps/web` | Next.js 16 (App Router, RSC, Server Actions), React 19, TypeScript, Tailwind v4, GSAP, Auth.js v5 |
| `apps/worker` | Python 3.13: FastAPI (внутренний API) + arq (очередь на Redis): автовыдача, холды, AI-задачи, агрегаты |
| `apps/mcp` | MCP-сервер на TypeScript (Streamable HTTP + stdio) |
| `packages/db` | Prisma 7: схема, миграции, seed, экспорт клиента |
| `packages/shared` | zod-схемы, константы, деньги (копейки), шифрование склада |
| `docs/CONTRACTS.md` | **Контракты между модулями** (зоны, леджер, статусы заказов, формат шифрования и т. д.) |

## Быстрый старт (без Docker)

Требуется Node.js ≥ 22, pnpm ≥ 10, Python 3.13, PostgreSQL 16 и Redis 7.

```bash
# 1. Локальные сервисы (PostgreSQL + Redis) и переменные окружения
bash scripts/services.sh start        # создаёт роль/БД asap/asapawge; либо поднимите свои
cp .env.example .env                  # и поправьте значения (AUTH_SECRET, STOCK_ENCRYPTION_KEY …)

# 2. Зависимости, БД, демо-данные
pnpm install
pnpm db:migrate                       # применяет миграции (создаёт расширение pg_trgm)
pnpm db:seed                          # демо-данные: товары, ключи, заказы за 60 дней, аккаунты

# 3. Python-воркер
cd apps/worker && uv venv --python 3.13 .venv && uv pip install --python .venv/bin/python -r requirements.txt && cd ../..
#   (или: python3.13 -m venv apps/worker/.venv && apps/worker/.venv/bin/pip install -r apps/worker/requirements.txt)

# 4. Запуск
pnpm dev                              # сайт: http://localhost:3000
pnpm worker:dev                       # воркер API: http://localhost:8000/docs
(cd apps/worker && .venv/bin/arq app.worker.WorkerSettings)   # потребитель очереди
pnpm --filter @asap/mcp dev           # MCP: http://localhost:3333/mcp
```

### Демо-аккаунты (после `pnpm db:seed`)

| Роль | Email | Пароль |
|---|---|---|
| Администратор | `admin@asapawge.gg` | `Admin123!` |
| Продавец | `seller@asapawge.gg` | `Seller123!` |
| Продавец | `gamekeys@asapawge.gg`, `subzone@asapawge.gg` | `Seller123!` |
| Покупатель (баланс 5 000 ₽) | `user@asapawge.gg` | `User123!` |

### Полезные команды

```bash
pnpm typecheck        # проверка типов во всех пакетах
pnpm lint             # ESLint (web)
pnpm test             # vitest (shared, web)
pnpm worker:test      # pytest (worker)
pnpm db:generate      # перегенерировать Prisma-клиент после изменения schema.prisma
pnpm db:studio        # Prisma Studio
pnpm build            # production-сборка web
```

## Запуск в Docker

```bash
cp .env.example .env     # обязательно задайте AUTH_SECRET, STOCK_ENCRYPTION_KEY, WORKER_INTERNAL_TOKEN
docker compose up -d --build postgres redis
docker compose --profile tools run --rm migrate                           # миграции
docker compose --profile tools run --rm migrate pnpm db:seed             # демо-данные (по желанию)
docker compose up -d --build web worker worker-jobs mcp
```

Сервисы: `web` :3000, `worker` :8000 (+ `worker-jobs` — потребитель arq), `mcp` :3333, `postgres` :5432, `redis` :6379.

## Режимы интеграций (sandbox / mock)

Если ключи не заданы, всё работает локально в тестовом режиме (явно помечается в интерфейсе и логах):

- **Платежи**: `PLATEGA_*` / `ROLLYPAY_*` пусты → провайдер `SANDBOX` (тестовая страница оплаты и подписанный webhook).
- **AI**: `AI_PROVIDER=mock` (или нет ключей `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENROUTER_API_KEY`) → детерминированный mock-провайдер.
- **Пополнение Steam**: `STEAM_TOPUP_PROVIDER=mock` → `MockSteamProvider`; для реального поставщика задайте `STEAM_TOPUP_API_URL` / `STEAM_TOPUP_API_KEY`.
- **Яндекс Метрика**: `NEXT_PUBLIC_YM_ID` пуст → счётчик не подключается, события пишутся только в собственную таблицу `AnalyticsEvent`.

> Схемы API Platega и RollyPay реализованы по публичной документации и должны быть сверены с актуальной версией перед продакшеном.

## Безопасность

Argon2id для паролей, RBAC на сервере (proxy + проверка роли в каждой странице/действии), rate-limit на Redis, AES-256-GCM для ключей на складе, проверка подписи webhook и идемпотентность, zod-валидация всех входов, аудит-лог админских действий.

## Дизайн-система

Тёмная тема по умолчанию (+ светлая), токены в `apps/web/src/app/globals.css` (`@theme`), шрифты Manrope + Unbounded (кириллица, self-hosted), UI-кит в `apps/web/src/components/ui`, анимации GSAP + ScrollTrigger (`@/lib/gsap`, компонент `Reveal`).
