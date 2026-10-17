# ASAPawge GG — Engineering Contracts

Single source of truth for all feature zones. **Read fully before you write code.**
Each zone appends new shared contracts under *"§20 Zone appendices"* (own sub-section only; never edit another zone's section).

- UI language: **Russian**. Code, comments, identifiers, commit messages: **English**.
- Money: **integer kopecks** everywhere (`1 ₽ = 100`). Never floats. Display with `formatRub()`.
- Stack versions (verified): Next.js 16.4 (Turbopack, App Router), React 19.3, Tailwind CSS 4.3, Prisma 7.10 (`prisma-client` generator + `@prisma/adapter-pg`), Auth.js `next-auth@5.0.0-beta.32`, zod 4, ioredis, Python 3.13 + FastAPI + arq + SQLAlchemy 2 (asyncpg).
- Next 16 gotchas: `middleware.ts` is now **`src/proxy.ts`**; `params`, `searchParams`, `cookies()`, `headers()` are **async** (`await`); Server Actions require `"use server"`; `useActionState` (React 19) replaces `useFormState`. Next ships docs inside `apps/web/node_modules/next/dist/docs/` — consult when unsure.

---------------------------------------------------------------------------------------------------

## 1. Running locally

```bash
bash scripts/services.sh start     # local Postgres 16 + Redis (no Docker); creates role asap/asap + db asapawge
cp .env.example .env               # already done by foundation; adjust as needed
pnpm install                       # postinstall generates the Prisma client (packages/db/src/generated, git-ignored)
pnpm db:migrate                    # prisma migrate dev  (use `pnpm db:deploy` in prod)
pnpm db:seed                       # WIPES all tables and loads demo data (see §13)
pnpm dev                           # web on :3000   (reads ROOT .env via dotenv-cli)
pnpm worker:dev                    # FastAPI worker :8000   (apps/worker/.venv)
cd apps/worker && .venv/bin/arq app.worker.WorkerSettings   # arq queue consumer
pnpm --filter @asap/mcp dev        # MCP server :3333 (POST /mcp), stdio: `pnpm --filter @asap/mcp start:stdio`
pnpm typecheck && pnpm lint && pnpm test && pnpm worker:test
```

After changing `packages/db/prisma/schema.prisma`: `pnpm db:migrate` (creates + applies migration and **you must run** `pnpm db:generate` — Prisma 7 does not auto-generate). Schema changes by feature zones must be **additive** (new nullable columns/tables) and recorded in §20 "Schema change log". Never edit an applied migration.

## 2. Zones & ownership

| Zone | Owner | Owns (create/edit freely) | Reads only |
|---|---|---|---|
| **A storefront** | agent A | `apps/web/src/app/(shop)/{page.tsx,catalog,product,steam,search,seller-store,info}`, `apps/web/src/components/shop/*`, `apps/web/src/server/catalog/*` (create it) | everything else |
| **B commerce** | agent B | `apps/web/src/app/(shop)/{cart,checkout}`, `apps/web/src/app/api/payments/*`, `apps/web/src/server/payments/*`, `apps/web/src/server/ledger/*`, `apps/web/src/server/orders/*`, `apps/web/src/server/cart/*` | |
| **C cabinets** | agent C | `apps/web/src/app/account/*`, `apps/web/src/app/seller/*`, `apps/web/src/components/cabinet/*` (create) | |
| **D admin & analytics** | agent D | `apps/web/src/app/admin/*`, `apps/web/src/server/analytics/*` (extend; keep `trackEvent` signature), `apps/web/src/components/analytics/*` (Yandex Metrika), `apps/web/src/app/api/analytics/*`, `apps/web/src/components/admin/*` (create) | |
| **E worker** | agent E | `apps/worker/*` (everything) | `packages/db/prisma/schema.prisma`, §6–§9, §11 |
| **F AI + MCP + API** | agent F | `apps/web/src/server/ai/*`, `apps/web/src/app/api/v1/*`, `apps/web/src/app/api/ai/*`, `apps/web/src/components/support-chat/*`, `apps/mcp/*` | |
| **Foundation** | (done) | everything else: root configs, `packages/*`, `src/components/ui`, `src/components/layout`, `src/components/providers`, `src/lib`, `src/server/{auth,audit.ts,notifications.ts,worker.ts,categories.ts,cart-count.ts}`, `src/auth*.ts`, `src/proxy.ts`, `(auth)` pages | |

Shared files (`package.json`, layout nav in `components/layout/*`, `globals.css`, `packages/shared/src/*`, `.env.example`, this doc): **minimal, additive edits only**; never reformat or reorder others' code. Adding to `packages/shared` is encouraged (new zod schemas / constants) — export them from `index.ts`.

## 3. Directory layout

```
apps/web/src
  app/
    (shop)/            public storefront (header+footer layout)   zones A + B
    (auth)/            /sign-in /sign-up + server actions          foundation
    account/ seller/ admin/   cabinets (own layouts w/ DashboardShell + server guards)
    api/auth/[...nextauth]    Auth.js handlers
    api/payments/* api/v1/* api/ai/* api/analytics/*   route handlers (zones B/F/D)
    forbidden/ not-found.tsx error.tsx layout.tsx globals.css
  components/ui/       design-system kit (Button, Card, Dialog, Select, Tabs, Table, Price, Rating, Reveal …)
  components/layout/   SiteHeader, SiteFooter, DashboardShell, PageHeader, PageStub …
  components/providers/ ThemeProvider, QueryProvider, GsapProvider
  components/{shop,cabinet,admin,analytics,support-chat}/   zone components
  lib/                 utils(cn), env, redis, rate-limit, request(ip), api(jsonOk/jsonError/parseJson), gsap
  server/              server-only code: auth/, audit.ts, notifications.ts, worker.ts, categories.ts, cart-count.ts, analytics/track.ts
  auth.ts auth.config.ts proxy.ts
apps/worker/app        main.py (FastAPI) worker.py (arq WorkerSettings) config.py crypto.py
apps/mcp/src           server.ts http.ts stdio.ts
packages/db            prisma/{schema.prisma,migrations,seed.ts,seed-data} src/{client,index,enums,settings}.ts
packages/shared        src/{money,constants,schemas,crypto,slug}.ts
```

Naming: files `kebab-case.ts(x)`; React components `PascalCase`; server actions in `actions.ts` next to the route with `"use server"`; zod schemas `fooSchema` in `@asap/shared` (shared across web/MCP/API) or colocated if zone-private; DB access only in server code (`server/**`, route handlers, RSC, actions) via `import { prisma } from "@asap/db"`. Client components get **plain serialisable props** (no Prisma objects with Date → convert).
Import aliases: `@/…` → `apps/web/src/…`; workspace packages: `@asap/db`, `@asap/db/enums` (client-safe enum values), `@asap/shared`.

## 4. Auth, session, roles (RBAC)

- Credentials login (email + password, argon2id). Session = JWT cookie with `{ id, role }`. Role/ban state is **re-read from DB** by the helpers below; the JWT role is only used by `proxy.ts` for coarse redirects.
- `src/proxy.ts` guards: `/account/*` any user · `/seller/*` SELLER|ADMIN · `/admin/*` ADMIN · `/checkout/*` any user. Unauthenticated → `/sign-in?callbackUrl=…`; wrong role → `/forbidden`.
- **Every** page/layout/action/route handler that is protected MUST also call a server helper (defence in depth) from `@/server/auth/session`:

| Helper | Use | On failure |
|---|---|---|
| `getSessionUser()` | RSC, optional auth (header). Returns `SessionUser \| null` (`id,email,name,image,role,balance`) | `null` |
| `requireUser(callbackUrl?)` | pages/layouts | `redirect('/sign-in…')` |
| `requireRole('ADMIN')`, `requireRole('SELLER','ADMIN')` | pages/layouts | `redirect('/forbidden')` |
| `assertRole(...roles)` | **server actions & route handlers** | throws `AuthError('UNAUTHENTICATED'\|'FORBIDDEN')` — catch → `jsonError(401/403, …)` or return `{ error }` |
| `hasRole(user, ...roles)` | UI conditionals | boolean |

- Ownership checks are the caller's job: sellers may touch only rows with `sellerId === user.id` (ADMIN bypasses); buyers only their `buyerId`. Never trust ids from the client without checking.
- Sign-up creates `USER` (or `SELLER` + `SellerProfile(status=PENDING)` when "I want to sell" is ticked). Admin verifies sellers (`SellerProfile.status`).
- Auth rate limits: login 10/15min per email, 30/15min per IP; sign-up 10/h per IP (Redis).
- API-key auth for `/api/v1/*` and MCP: see §12.

## 5. Server-action / route-handler conventions

- Validate **all** input with zod (`schema.safeParse`). Server actions return `{ ok: true, data } | { ok: false, error: string, fieldErrors? }` (Russian messages) — do not throw for expected failures. `redirect()` only at the end.
- Route handlers return the envelope from `@/lib/api`: `jsonOk(data)` → `{ ok: true, data }`, `jsonError(status, code, message, details?)` → `{ ok: false, error: { code, message, details } }`. Use `parseJson(req, schema)` and `limitByIp(req, 'bucket', limit, windowSec)`.
- Rate-limit any public mutation: `rateLimit({ key, limit, windowSec })` from `@/lib/rate-limit` (Redis fixed window; falls back to memory).
- Locks / idempotency: `acquireLock(key, ttlMs)` / `withLock()` from `@/lib/redis` + DB unique constraints (`Payment @@unique([provider, externalId])`, `WebhookEvent @@unique([provider, eventId])`). Cache: `cached(key, ttlSec, loader)`.
- Privileged actions (admin/moderation/payout/refund/role/ban/settings) → `writeAudit({ actorId, action, entityType, entityId, before, after, ip })` from `@/server/audit`. Action names: `entity.verb` (`product.approve`, `user.ban`, `payout.paid`, `order.refund`, `settings.update`).
- User-facing events → `notify(userId, { type, title, body, link })` from `@/server/notifications`.
- Heavy/async work → enqueue to the worker via `enqueueJob(name, args)` (`@/server/worker`, §10). It never throws.
- Analytics: server `trackEvent({ name, userId, sessionId, path, properties })` (`@/server/analytics/track`, never throws).
- Dynamic data pages: `export const dynamic = "force-dynamic"` unless you deliberately cache (`revalidate`, `cached()`).
- Images: `next/image` with remote hosts allow-listed in `next.config.ts` (`picsum.photos`, `placehold.co`, `images.unsplash.com`, steamstatic). Add hosts there (additive).

## 6. Money

- Type: integer kopecks. DB `Int` (max ≈ 21.4 M ₽ per value; sums via Prisma `_sum` are fine).
- `@asap/shared/money`: `formatRub(k)` → `"1 500 ₽"` / `"199,99 ₽"`, `rubToKopecks("199,99")`, `kopecksToRub`, `discountPercent(price, old)`, `splitCommission(amount, bps) → { fee, net }` (fee = round-half-up(amount·bps/10000)), `percentOf`.
- Commission is **basis points** (`1000` = 10 %). Effective bps = `SellerProfile.commissionBps ?? Setting("commission.defaultBps") ?? 1000`. It is **snapshotted** on each `OrderItem` (`commissionBps`, `commissionAmount`, `sellerEarning`).
- `OrderItem.total` is **after** the item's proportional share of the order discount (promo). `Order.total = subtotal − discount = Σ OrderItem.total`. Commission is computed on `OrderItem.total`.
- Product price: `Product.price` = base ("from") price; if `variants` exist, `Product.price` = min active variant price and the buyer picks a variant (`ProductVariant.price` is the real price). Keep `Product.price` in sync when variants change.

## 7. Order lifecycle (state machine)

```
              pay confirmed                  all items delivered             buyer opens dispute
 PENDING ───────────────► PAID ──► PROCESSING ──────────────► DELIVERED ────────────────► DISPUTED
   │  │                    │            │                        │  ▲                        │
   │  └─► CANCELLED        │            └─► FAILED               │  └── resolved: rejected ──┘
   └─► FAILED (payment)    └─► (auto-deliver: PAID→DELIVERED directly allowed)
                                                                  └─► REFUNDED  ◄── resolved: refund / admin refund / FAILED→refund
```

Transitions (`ORDER_TRANSITIONS` in `@asap/shared`; enforce in `server/orders` — never `prisma.order.update({status})` ad hoc):

| From | To | Trigger / owner |
|---|---|---|
| PENDING | PAID | payment confirmed (webhook / balance) — **zone B** |
| PENDING | CANCELLED | user cancels, or `expire_pending_orders` (unpaid > 30 min) — B / worker |
| PENDING | FAILED | payment failed/declined — B |
| PAID | PROCESSING | `fulfill_order` started (MANUAL/AUTO_PROVIDER pending) — worker |
| PAID/PROCESSING | DELIVERED | every OrderItem DELIVERED — worker (`deliveredAt`, `holdReleaseAt = deliveredAt + holdDays`) |
| PROCESSING/PAID | FAILED | delivery failed after retries — worker; admin decides refund/retry |
| DELIVERED | DISPUTED | buyer opens `Dispute` (only before hold release is final; allowed up to 14 d) — zone C |
| DISPUTED | DELIVERED | dispute resolved in seller's favour — admin (D) |
| DELIVERED/DISPUTED/FAILED/PAID | REFUNDED | admin or auto-resolution — B (ledger) triggered from D/C |

`OrderItem.status`: `PENDING → PROCESSING → DELIVERED | FAILED | REFUNDED`. Order-level status is derived from items on delivery.

Delivery modes: **AUTO_STOCK** (take encrypted `StockItem`s), **AUTO_PROVIDER** (Steam top-up etc. via adapter; result in `OrderItem.deliveryData`), **MANUAL** (seller fulfils from `/seller/orders`, sets `deliveryData.message`, marks DELIVERED).

Stock reservation (AUTO_STOCK): when the order is **created**, zone B reserves `quantity` items per line in one transaction: `SELECT … FROM "StockItem" WHERE "productId"=$1 AND ("variantId"=$2) AND status='AVAILABLE' ORDER BY "createdAt" LIMIT n FOR UPDATE SKIP LOCKED` → `status='RESERVED', reservedUntil=now()+15min, orderItemId=…`. Not enough stock → refuse checkout ("Нет в наличии"). On delivery the worker sets `SOLD` (+`soldAt`). `expire_reservations` (cron, worker) frees RESERVED rows past `reservedUntil` whose order is still PENDING; paying extends/marks them as final (set `reservedUntil = NULL` on payment).
Delivered content is shown to the buyer by decrypting `StockItem.payloadEnc` (§11) **server-side only**, only for `OrderItem`s of the buyer's own paid order (never in list endpoints, never logged).

## 8. Ledger (double entry) — posting rules

Table `LedgerEntry`. One posting = several rows sharing a `txId`; **Σ DEBIT = Σ CREDIT per txId** (assert before commit). `amount > 0` always (DB CHECK). Account types and balance sign:

| Account | `ownerId` | Meaning | Balance = |
|---|---|---|---|
| `USER_BALANCE` | buyer id | site balance (cached in `User.balance`) | Σ CREDIT − Σ DEBIT |
| `SELLER_HOLD` | seller id | earned, on hold (cached `SellerProfile.holdBalance`) | Σ CREDIT − Σ DEBIT |
| `SELLER_AVAILABLE` | seller id | withdrawable (cached `availableBalance`) | Σ CREDIT − Σ DEBIT |
| `PLATFORM_FEE` | null | platform revenue | Σ CREDIT − Σ DEBIT |
| `EXTERNAL` | null | outside world (cards/SBP/bank). DEBIT = money came **in**, CREDIT = money went **out** | Σ DEBIT − Σ CREDIT |

All postings + cache updates (`User.balance`, `SellerProfile.holdBalance/availableBalance`) happen in **one Prisma `$transaction`**; `User.balance` must never go negative (DB CHECK) — use `UPDATE … WHERE balance >= amount` (or `updateMany` with `balance: { gte }`) and treat 0 rows as "insufficient funds".

| Event | kind | Entries (txId per line) |
|---|---|---|
| Gateway payment of an order succeeds (card/SBP via Platega/RollyPay/Sandbox) | `TOPUP` | DEBIT `EXTERNAL` gross · CREDIT `USER_BALANCE`(buyer) gross — `paymentId`, `orderId` set. **Then immediately the PURCHASE posting below** (uniform: money always passes through the buyer balance) |
| Balance top-up (Payment.purpose = BALANCE_TOPUP) | `TOPUP` | DEBIT `EXTERNAL` · CREDIT `USER_BALANCE` |
| Order paid (per `OrderItem`) | `PURCHASE` | DEBIT `USER_BALANCE`(buyer) `item.total` · CREDIT `SELLER_HOLD`(seller) `sellerEarning` · CREDIT `PLATFORM_FEE` `commissionAmount` — `orderItemId` set |
| Hold released (`holdReleaseAt ≤ now`, item DELIVERED, order not DISPUTED/REFUNDED; worker cron `release_holds`) | `HOLD_RELEASE` | DEBIT `SELLER_HOLD` `sellerEarning` · CREDIT `SELLER_AVAILABLE` `sellerEarning`; set `OrderItem.holdReleased = true` |
| Payout requested (seller) | `PAYOUT` | DEBIT `SELLER_AVAILABLE` `amount` · CREDIT `EXTERNAL` `amount` (funds leave available immediately; `Payout.status=REQUESTED`) |
| Payout rejected/cancelled | `PAYOUT_REVERSAL` | DEBIT `EXTERNAL` · CREDIT `SELLER_AVAILABLE` (mirror) |
| Payout marked PAID by admin | — | no entries (already posted at request); set `status=PAID, processedAt, processedById` + audit |
| Refund of an item (refund goes to **buyer's site balance**) | `REFUND` | if hold not released: DEBIT `SELLER_HOLD` `sellerEarning` else DEBIT `SELLER_AVAILABLE` `sellerEarning` · DEBIT `PLATFORM_FEE` `commissionAmount` · CREDIT `USER_BALANCE`(buyer) `item.total`. Order → REFUNDED when all items refunded. (Withdrawing a balance to a card = out of MVP scope.) |
| Admin adjustment | `ADJUSTMENT` | any balanced set, with `memo`; always audited |

Minimum payout: `MIN_PAYOUT_KOPECKS` (1 000 ₽). Hold: `Setting("commission.holdDays")` default 3 days.
Integrity SQL used by the seed check (should return 0 rows): `SELECT "txId" FROM "LedgerEntry" GROUP BY 1 HAVING SUM(CASE WHEN direction='DEBIT' THEN amount ELSE -amount END) <> 0;`

## 9. Payments (zone B)

- `Payment { provider PLATEGA|ROLLYPAY|BALANCE|SANDBOX, purpose ORDER|BALANCE_TOPUP, externalId, status CREATED|PENDING|PAID|FAILED|CANCELLED|EXPIRED|REFUNDED, amount, paymentUrl, raw(JSON) }`, unique `(provider, externalId)`.
- Adapter interface (put in `src/server/payments/types.ts`): `createPayment({ payment, order?, returnUrl }) → { externalId, paymentUrl }` and `verifyWebhook(rawBody, headers) → { eventId, externalId, status, amount } | throws`. Real HTTP adapters for Platega (`PLATEGA_API_URL`, `PLATEGA_MERCHANT_ID`, `PLATEGA_SECRET`) and RollyPay (`ROLLYPAY_*`) read env via `@/lib/env` (`env.platega.configured`, `env.rollypay.configured`). **If keys are absent → SANDBOX provider**: payment page `/checkout/sandbox/[paymentId]` (clearly labelled "ТЕСТОВЫЙ РЕЖИМ") that POSTs a webhook signed with `SANDBOX_WEBHOOK_SECRET` (HMAC-SHA256 hex of raw body in `x-signature`). Endpoints: `POST /api/payments/webhook/{platega|rollypay|sandbox}`. Mark API shapes "verify against provider docs before production" in code comments.
- Webhook handling order: verify signature → insert `WebhookEvent(provider,eventId)` (unique → duplicate = 200 OK no-op) → `withLock('payment:'+externalId)` → in one DB tx: Payment PAID, Order PAID (+`paidAt`), ledger postings (§8), clear stock `reservedUntil` → after commit `enqueueJob('fulfill_order', { orderId })`. Always respond 2xx for already-processed events.
- Balance payment: same tx without the `TOPUP` leg; fails with "Недостаточно средств" if balance < total.
- Promo codes: validate (`isActive`, `expiresAt`, `maxUses`/`usedCount`, `minOrder`, per-user limit via Orders with `promoCodeId`), `PERCENT` → `percentOf`, `FIXED` → min(value, subtotal), cap `maxDiscount`; increment `usedCount` on payment success.

## 10. Web ↔ worker contract (HTTP; chosen over raw Redis/arq enqueue)

```
POST {WORKER_URL}/internal/jobs/{name}
Authorization: Bearer {WORKER_INTERNAL_TOKEN}
Content-Type: application/json
{ "args": { ... }, "delaySeconds": 0 }          →  202 { "ok": true, "jobId": "…" }   (401 bad token, 404 unknown job)
```
Web code calls `enqueueJob(name, args, { delaySeconds })` from `@/server/worker` (returns `{ ok, jobId?, error? }`, never throws; callers must tolerate `ok:false` — cron `expire_*`/`release_holds` + a periodic "stuck PAID orders" sweep in the worker are the safety net). The FastAPI app (`apps/worker/app/main.py`) enqueues into arq (Redis); the consumer is `arq app.worker.WorkerSettings` (`apps/worker/app/worker.py`). Job function signature: `async def name(ctx, args: dict)`; jobs are **idempotent** (re-runnable) and use DB row locks (`FOR UPDATE SKIP LOCKED`).

| Job | args | Trigger | Does |
|---|---|---|---|
| `fulfill_order` | `{ orderId }` | web after payment | deliver items per mode (§7), set statuses/timestamps, notifications, analytics `purchase` already tracked by web |
| `release_holds` | `{}` | cron every 15 min | §8 HOLD_RELEASE for eligible items |
| `expire_reservations` | `{}` | cron | free expired RESERVED stock |
| `expire_pending_orders` | `{}` | cron | PENDING > 30 min → CANCELLED, release stock |
| `ai_moderate_product` | `{ productId }` | web when seller submits (status PENDING_REVIEW) | LLM moderation → `Product.aiModeration` JSON `{score 0-100, verdict approve\|review\|reject, reasons[]}`; score ≥ `Setting(ai.autoPublishThreshold)`(80) & verdict approve → ACTIVE else stays PENDING_REVIEW / REJECTED; writes `AiLog` |
| `ai_moderate_review` | `{ reviewId }` | web on review create | flags → `Review.aiFlags`, may HIDE |
| `ai_score_fraud` | `{ orderId }` | web on order create | `Order.fraudScore` 0-100 |
| `aggregate_daily_metrics` | `{ date? }` | cron 00:05 UTC | upsert `DailyMetric` for the day (definitions §14) |
| `send_notification` | `{ userId, type, title, body?, link? }` | any | create `Notification` (email later) |

The worker reads/writes Postgres directly (SQLAlchemy asyncpg; table/column names exactly as Prisma: quoted PascalCase tables e.g. `"OrderItem"`, camelCase columns e.g. `"sellerEarning"`; enum values as strings). It must follow the same ledger rules (§8) and encryption format (§11) for anything it posts. Env shared via root `.env` (`DATABASE_URL`, `REDIS_URL`, `WORKER_INTERNAL_TOKEN`, `STOCK_ENCRYPTION_KEY`, `STEAM_TOPUP_*`, `AI_*`, keys).
Steam top-up supplier: interface `TopupProvider { check_login(login) -> bool; topup(login, amount_rub, ref) -> {status, tx_id} }`; implementations `MockSteamProvider` (default, `STEAM_TOPUP_PROVIDER=mock`, deterministic) and `HttpSteamProvider` (`STEAM_TOPUP_API_URL/KEY`). Web may need `check_login` for the calculator: expose later as `POST /internal/steam/check-login` on the worker (zone E) — token-protected like jobs.

## 11. Stock encryption (AES-256-GCM)

```
StockItem.payloadEnc = base64( iv[12 bytes] || authTag[16 bytes] || ciphertext )
key   = STOCK_ENCRYPTION_KEY  (32 bytes; base64 OR 64 hex chars)   AAD = none   plaintext = UTF-8
StockItem.fingerprint = sha256_hex(plaintext.trim())     // dedupe, unique with productId
```
TS: `encryptStock / decryptStock / stockFingerprint / parseStockKey` from `@asap/shared`. Python: `apps/worker/app/crypto.py` (`encrypt_stock/decrypt_stock/stock_fingerprint/parse_key`); `cryptography`'s AESGCM wants `ct||tag`, so split/join as shown there. Cross-language vector is tested in `apps/worker/tests/test_crypto.py`. Plaintext formats by product type: KEY/GIFT_CARD → the code string; ACCOUNT/SUBSCRIPTION → `login:password` or a URL/code — free text, shown verbatim. Never log plaintext; decrypt only at delivery-display time.

## 12. API keys, REST API v1, MCP (zone F)

- Key format: `ak_live_` + 48 hex chars (24 random bytes). Store only `ApiKey.hash = sha256_hex(key)` and `prefix` (first 16 chars) — show the full key once at creation. `generateApiKey()`, `hashApiKey()`, `isApiKeyFormat()` in `@asap/shared`. Header: `Authorization: Bearer ak_live_…` (or `X-API-Key`). Lookup by hash; reject if `revokedAt`/expired/user banned; update `lastUsedAt`; effective role = `min(ApiKey.role, User.role)`; `scopes` ⊆ `ROLE_SCOPES[role]`.
- Scopes: `catalog:read, orders:read, orders:create, seller:products, seller:stock, seller:stats, admin:metrics, admin:moderate`.
- REST: `/api/v1/*` JSON envelope identical to §5, rate-limited per key (Redis), OpenAPI document at `/api/v1/openapi.json`. Key management UI lives in cabinets (C: `/account/api-keys`, `/seller/api-keys`) and calls helpers placed by F in `src/server/api-keys/*` (F owns; C consumes — F must publish the helper signatures in §20-F early).
- MCP server (`apps/mcp`): Streamable HTTP `POST /mcp` (port `MCP_PORT`, default 3333) + stdio; authenticates with the same API key and forwards to `MCP_API_BASE_URL` (REST v1). Tools: `search_products, get_product, create_order, get_order_status, list_my_orders, seller_create_product, seller_upload_stock, seller_stats, admin_metrics, admin_moderate_product` — tools hidden/denied by scope.
- AI providers (`src/server/ai`): interface `LLMProvider { chat(messages, opts) }` with OpenAI, Anthropic, OpenRouter adapters + **mock** provider (deterministic, labelled) when no key. Selection: `Setting(ai.provider)` ▸ `AI_PROVIDER` env, fallback chain over configured providers. Every call → `AiLog`.

## 13. Seed data / demo accounts

`pnpm db:seed` (wipes everything, deterministic RNG): 

| Email | Password | Role | Notes |
|---|---|---|---|
| admin@asapawge.gg | `Admin123!` | ADMIN | |
| seller@asapawge.gg | `Seller123!` | SELLER | "Digital Hub", 10 % |
| gamekeys@asapawge.gg | `Seller123!` | SELLER | "GameKeys Store", 8 % |
| subzone@asapawge.gg | `Seller123!` | SELLER | "SubZone", default commission |
| user@asapawge.gg | `User123!` | USER | balance 5 000 ₽ (ledger-consistent) |
| buyer1..16@example.com, newbie1..14@example.com | `Buyer123!` | USER | history for analytics |

~49 products (44 ACTIVE + 2 PENDING_REVIEW, 1 REJECTED, 1 DRAFT, 1 ARCHIVED) in 13 categories (tree: Игры ▸ Steam ключи/Xbox/PlayStation/Nintendo; Подписки ▸ Игровые/ИИ-сервисы/Музыка и видео; Пополнение Steam; Подарочные карты; Игровая валюта; Программы), ~1 170 encrypted stock items (Starfield deliberately out of stock), ~250 orders over 60 days with payments, ledger, reviews, 4 DISPUTED + 1 resolved dispute, payouts (2 PAID, 1 REQUESTED), promo codes `WELCOME10` (10 %), `SUMMER500` (500 ₽ off ≥ 3 000 ₽), `EXPIRED20` (inactive), ~6 500 AnalyticsEvents, 61 `DailyMetric` rows, AiLog/AuditLog/Notification samples. Product images: `https://picsum.photos/seed/<slug>/…`.

## 14. Analytics

**Event names** (`ANALYTICS_EVENTS` in `@asap/shared`; table `AnalyticsEvent`; `properties` JSON):

| name | when | properties |
|---|---|---|
| `page_view` | each client navigation | — (`path`, `referrer` columns) |
| `view_item` | product page | `{ productId }` |
| `search` | search submitted | `{ q, results }` |
| `add_to_cart` / `remove_from_cart` | cart change | `{ productId, variantId?, quantity, value }` |
| `begin_checkout` | checkout opened | `{ value, items }` |
| `add_payment_info` | method chosen | `{ method }` |
| `purchase` | order PAID (server) | `{ orderId, value (RUB, number), currency:'RUB', method }` |
| `sign_up`, `login` | auth | `{ role }` |
| `topup_balance`, `steam_topup_start` | balance / Steam calculator | `{ value }` |
| `favorite_add`, `review_submit`, `dispute_open`, `ai_chat_message` | social | `{ productId?/orderId? }` |

Client: zone D exposes `trackClient(name, props)` (posts to `/api/analytics/event`, validated with `analyticsEventSchema`, rate-limited) and forwards to Yandex Metrika (`ym(id,'reachGoal', name, params)` + ecommerce `dataLayer` per YM docs) when `NEXT_PUBLIC_YM_ID` (or `Setting(analytics.ymId)`) is set. `sessionId` = anonymous cookie `asap_sid` (UUID, 30 d). Server code uses `trackEvent` (foundation stub in `server/analytics/track.ts`).
**DailyMetric** definitions (UTC day): `gmv` = Σ `Order.total` with `paidAt` in the day and status ∉ {PENDING,CANCELLED,FAILED,REFUNDED}; `platformRevenue` = Σ `commissionAmount` of those orders; `ordersCreated` by `createdAt`; `ordersPaid` by `paidAt`; `newUsers` by `User.createdAt`; `activeUsers` = distinct user/session ids with any event/order that day; `sessions` = distinct `sessionId`; `refunds` = Σ refunded totals; `avgOrderValue` = gmv/ordersPaid; `data = { funnel:{page_view,view_item,add_to_cart,begin_checkout,purchase}, topProducts:[…], topSellers:[…] }`.

## 15. Settings (`Setting` table, JSON values — keys in `SETTING_KEYS`)

`commission.defaultBps` (1000) · `commission.holdDays` (3) · `ai.provider` ("mock") · `ai.model` · `ai.autoPublishThreshold` (80) · `payments.enabled` ({PLATEGA,ROLLYPAY,BALANCE,SANDBOX}) · `analytics.ymId` · `site.maintenance` · `site.supportContacts`. Read with `getSetting(key, fallback)` / write with `setSetting(key, value, actorId)` from `@asap/db` (admin settings UI = zone D; always audit).

## 16. UI kit & design system

- Dark by default (`<html class="dark">`), light via `.light`. Theme toggle `ThemeToggle`, hook `useTheme()`. Tokens are CSS variables mapped through Tailwind v4 `@theme inline` → utilities: `bg-background text-foreground bg-card border-border bg-primary text-primary-foreground bg-secondary text-muted-foreground bg-accent text-success text-warning text-destructive`. Brand = violet `#8b5cf6` → cyan `#22d3ee`. Helper utilities (in `globals.css`): `glass`, `gradient-brand`, `gradient-brand-text`, `gradient-border`, `glow-hover`, `skeleton`, `container-page`, `no-scrollbar`; fonts: `font-sans` (Manrope), `font-display` (Unbounded, auto on `h1–h3`). Radii: use `rounded-xl`/`rounded-2xl`.
- Components in `@/components/ui` (import from `@/components/ui` barrel or file): Button (`variant` default|secondary|outline|ghost|glass|destructive|success|link, `size`, `loading`, `asChild`), Input, Textarea, Label/`Field`, Card*, Badge (incl. `discount`), Skeleton, Separator, Dialog* (+`side="left|right"` drawer), Tabs*, Select*, DropdownMenu*, Avatar/`UserAvatar`, Table*, Tooltip*, Popover*, Checkbox, Switch, ScrollArea, Progress, Accordion*, `EmptyState`, `Price` (kopecks + old price + -N%), `Rating`, `CategoryIcon`, `Reveal` (GSAP ScrollTrigger reveal, `stagger`). Toasts: `import { toast } from "@/components/ui/sonner"` (`<Toaster/>` is mounted in the root layout).
- GSAP: `import { gsap, ScrollTrigger, useGSAP, prefersReducedMotion } from "@/lib/gsap"` (client only; plugins auto-registered; always honour `prefersReducedMotion()`; use `useGSAP(() => {…}, { scope: ref })` for auto-cleanup). Hide-before-animate pattern: `.js [data-reveal]{opacity:0}` (the `js` class is set pre-paint).
- Cabinet layouts use `DashboardShell`/`PageHeader` (`components/layout/dashboard-shell.tsx`) — extend each cabinet's `nav` array in its own `layout.tsx`.
- Pages not yet implemented render `<PageStub zone="…"/>`; delete the stub when you implement the page.
- Placeholders owned by other zones, rendered from the root layout — **keep the exports**: `<Analytics/>` (`components/analytics/index.tsx`, zone D), `<SupportChat/>` (`components/support-chat/index.tsx`, zone F).

## 17. URL scheme

`/` · `/catalog?category={slug}&platform=&region=&type=&minPrice=&maxPrice=&sort=&page=` (schema `catalogQuerySchema`) · `/product/{slug}` · `/steam` · `/search?q=` · `/seller-store/{sellerSlug}` · `/info/{faq|rules|guarantees|seller-rules|api|offer|privacy|contacts}` · `/cart` · `/checkout` (+ `/checkout/sandbox/{paymentId}`, `/checkout/success?order={id}`) · `/sign-in` `/sign-up` · `/account/{orders,orders/[id],balance,favorites,reviews,disputes,api-keys,settings}` · `/seller/{products,stock,orders,payouts,reviews,analytics,api-keys}` · `/admin/{users,moderation,orders,disputes,payouts,categories,promocodes,analytics,ai,audit,settings,docs}` · `/api/auth/*` · `/api/payments/webhook/{provider}` · `/api/v1/*` · `/api/ai/*` · `/api/analytics/event`.
Guest cart: cookie `asap_cart` = `Cart.guestToken` (header badge uses `getCartCount`); on sign-in zone B merges guest cart into the user cart. Checkout requires login.

## 18. Environment variables

See `.env.example` (authoritative, commented). Keys: `DATABASE_URL, REDIS_URL, APP_URL, NEXT_PUBLIC_APP_URL, AUTH_SECRET, AUTH_TRUST_HOST, AUTH_URL, STOCK_ENCRYPTION_KEY, PLATEGA_MERCHANT_ID/SECRET/API_URL, ROLLYPAY_API_KEY/SECRET/API_URL, SANDBOX_WEBHOOK_SECRET, AI_PROVIDER, AI_MODEL, OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, NEXT_PUBLIC_YM_ID, WORKER_URL, WORKER_INTERNAL_TOKEN, WEB_INTERNAL_URL, STEAM_TOPUP_PROVIDER, STEAM_TOPUP_API_URL, STEAM_TOPUP_API_KEY, MCP_PORT, MCP_API_BASE_URL, COMMISSION_DEFAULT_BPS, HOLD_DAYS`. Web reads them through `@/lib/env` (typed; `*.configured` flags). New env var → add to `.env.example` **and** `docker-compose.yml` `x-env` block, and to `lib/env.ts`. `NEXT_PUBLIC_*` are exposed to the browser — never put secrets there.

## 19. Testing & quality bar

- `pnpm typecheck` (all packages), `pnpm lint` (web), `pnpm test` (vitest: shared + web), `pnpm worker:test` (pytest), Playwright smoke in `apps/web/e2e` (browser binaries are not installable in this sandbox — write tests but verify flows via curl/vitest).
- No hardcoded business data in pages — everything from Postgres. External integrations: real HTTP adapter + clearly-labelled sandbox/mock fallback.
- Check roles server-side on every protected action; validate every input with zod; audit privileged writes; never expose `passwordHash`, `payloadEnc`, plaintext stock, API-key hashes to clients.

---------------------------------------------------------------------------------------------------

## 20. Zone appendices (append below; one sub-section per zone)

### 20-A Storefront

**Routes (zone A):** `/` · `/catalog` · `/catalog/[category]` (legacy `/catalog?category=slug` → 307 to `/catalog/slug`) · `/search?q=` · `/product/[slug]` (reviews page via `?rpage=`) · `/steam` (`?amount=` prefill) · `/seller-store/[slug]` · `/store/[sellerId]` (308 → `/seller-store/{slug}`; accepts user id or slug) · `/info/{faq|rules|guarantees|seller-rules|api|offer|privacy|contacts}` · `/robots.txt` · `/sitemap.xml`.

**Catalog query** (`@/server/catalog/query`, client-safe): `catalogPageQuerySchema` extends the shared `catalogQuerySchema` with `discount`, a safe boolean `inStock` (`"1"|"true"|"on"`), **coercing** `minPrice/maxPrice` (kopecks, URL values are strings) and `sort ∈ popular|new|price_asc|price_desc|rating|discount|relevance` (`relevance` only on `/search`). `parseCatalogParams(rawSearchParams, defaults?)` is lenient (drops invalid keys), `buildCatalogQs(query, overrides?, { omit?, defaultSort? })` builds the querystring (the category lives in the path, never in the qs). Server data helpers (`@/server/catalog/queries`): `listProducts`, `getFacets`, `getCategoryTiles`, `resolveCategory`, `getProductShelf`, `getProductBySlug`, `getStockByVariant`, `getProductReviews`, `getSimilarProducts`, `getSellerBySlugOrUserId`; card payload type `ProductCardData` (`@/server/catalog/types`, serialisable, kopecks) + `<ProductCard p={…}/>` in `@/components/shop/product-card` — reuse it for favourites / seller lists in cabinets.

**Stock rule:** `inStock = deliveryMode !== "AUTO_STOCK" || count(StockItem AVAILABLE) > 0` (per variant on the product page).

**Search:** `GET /api/search/suggest?q=` → `{ ok, data: { q, total, products[], categories[] } }`, Redis-cached 60 s (`cache:suggest:*`), rate-limited 90/min/IP. Ranking = exact title > prefix > substring > `pg_trgm` similarity (typos) > tags, plus an alias dictionary (`гта`→grand theft auto, `спотифай`→spotify …) and wrong-keyboard-layout fallback (`@/server/catalog/search`: `searchProductIds`, `suggest`).

**Cart contract (storefront → zone B).** The storefront never writes carts itself: `@/server/catalog/cart-bridge.addItemToCart(input)` re-validates the Steam login with the TopupProvider (for Steam TOPUP) and then calls B's `@/server/cart/service.addItem` (via `resolveCartOwner({create:true})`). `CartItem.meta` keys the storefront sets (same as B's `itemMetaSchema`): `steamLogin` (TOPUP), `amountKopecks` (custom Steam wallet amount, kopecks **credited to the wallet**, only when no variant is chosen), `buyerInput` (MANUAL products: UID/login/email). Client entry points are server actions in `@/server/catalog/actions`: `addToCartAction({productId, variantId?, quantity, meta?})`, `toggleFavoriteAction(productId)` (error text `"UNAUTHENTICATED"` for guests), `startSteamTopupAction({currency:"RUB"|"KZT", login, amount})` — all return `{ ok:true, data } | { ok:false, error, fieldErrors? }`. "Купить сейчас" = add to cart + `router.push("/checkout")`.

**Steam top-up.** Fee = `Setting("steam_topup_fee_percent")` (number, percent; seeded `4`; fallback `STEAM_TOPUP_FEE_BPS/100`). Math lives in `@asap/shared`: `quoteSteamTopup(amountKopecks, feePercent) → { amount, fee, total }` (range `STEAM_TOPUP_MIN/MAX_KOPECKS`). Preset amounts map to the TOPUP product variants (`attributes.amountRub` / `amountKzt`, price from DB); any other RUB amount is a variant-less line with `meta.amountKopecks`, priced by B with `quoteSteamTopup`. Supplier interface in `@/server/topup/provider`: `TopupProvider { checkLogin(login) → {ok, displayName?, reason?, source}; topup({login, amountRub, ref}) → {status, txId} }`, `MockSteamProvider` (default; logins containing `invalid|notfound|nouser` are rejected) and `HttpSteamProvider` (`STEAM_TOPUP_PROVIDER=http` + `STEAM_TOPUP_API_URL/KEY`; endpoint shape documented in the file — verify against the supplier docs). `checkSteamLogin(login)` is the Redis-cached (10 min) entry point; HTTP: `POST /api/steam/check-login {login}` (20/min/IP). Real delivery stays in the worker (`fulfill_order`).

**Metrika helpers** (client only, no-op without a counter): `@/lib/metrika` → `reachGoal(goal, params?)`, `pushEcommerce('detail'|'add'|'remove', product)`. Goals fired by the storefront: `add_to_cart`, `buy_now`, `view_item`, `search`, `favorite_add`, `steam_topup_start`, `steam_promo_click`. Server-side events tracked: `view_item`, `search`, `favorite_add`, `add_to_cart`, `steam_topup_start`.

**Misc:** product pages render `Product`/`AggregateOffer`/`AggregateRating`/`Review` + `BreadcrumbList` JSON-LD, category pages `BreadcrumbList`, `/steam` and `/info/faq` `FAQPage`. Product `attributes.activation` (string[]) overrides the generated activation steps. Header search (`components/layout/search-bar.tsx`) now has live suggest + local history (`localStorage`, wrapped in try/catch).

### 20-B Commerce

Implemented in `apps/web/src/server/{cart,orders,payments,ledger}`, pages `app/(shop)/{cart,checkout}`, routes `app/api/payments/*`, components `components/{cart,commerce}`.
Everything below is verified by `pnpm --filter @asap/web test` (pure unit tests) and `bash scripts/test-int.sh` (integration suite against a throw-away `asapawge_test` DB: real Postgres + Redis, worker intentionally down).

**Deviations / decisions to know**
- `STOCK_RESERVATION_MINUTES` is now **30** (was 15 in §7) — equal to the unpaid-order expiry, so a reservation never expires before its order. Paid orders have `reservedUntil = NULL` (RESERVED rows stay linked to the order until delivery sets them SOLD).
- A **failed/declined payment does not fail the order** (it stays `PENDING` so the buyer can retry with another method on `/checkout/pay/[orderId]`); it is cancelled by expiry after 30 min. `OrderStatus.FAILED` is reserved for delivery failures.
- Money for an order that can no longer be fulfilled (order already cancelled/expired, or stock vanished) is **never lost**: `markPaid` credits it to the buyer's site balance (`TOPUP` posting + notification) and answers 2xx.
- Webhook route: `POST /api/payments/webhook/{platega|rollypay|sandbox}` (+ alias `POST /api/payments/{provider}/webhook`). Housekeeping route for the worker cron: `POST /api/payments/maintenance` (`Authorization: Bearer $WORKER_INTERNAL_TOKEN`) → releases expired reservations, cancels PENDING orders > 30 min, fulfils stuck PAID orders inline. Idempotent; the worker's own Python `expire_*` jobs remain valid alternatives.
- Sandbox availability: `isSandboxAllowed()` — on in dev; in production only while neither Platega nor RollyPay is configured (or `ALLOW_SANDBOX_PAYMENTS=1`). Change `SANDBOX_WEBHOOK_SECRET` in any shared deployment.
- Provider adapters (Platega / RollyPay) are written from the public API shape — paths, header names and Platega method ids are env-overridable (`PLATEGA_*`, `ROLLYPAY_*` in `.env.example`) and marked "verify against provider docs before production".

**Cart contract** (`src/server/cart`, cookie `asap_cart` = `Cart.guestToken`, merge on sign-in/sign-up via `mergeGuestCartForUser/Email` hooks in `(auth)/actions.ts`; also lazily when a signed-in user still has the cookie)
- Buyer input in `CartItem.meta` / `OrderItem.meta` (whitelisted keys only): `steamLogin` (TOPUP/STEAM), `amountKopecks` (custom Steam wallet amount, no variant), `buyerInput` (MANUAL products). Lines missing required input stay in the cart but block checkout (`CartLine.requiredInput`).
- **Prices are always recomputed server-side** (`cart/pricing.ts` `resolveUnitPrice`): variant price → else `Product.price` (no variants) → else, for TOPUP with `amountKopecks`, `quoteSteamTopup(amount, Setting steam_topup_fee_percent).total`. `OrderItem.unitPrice` includes the fee; the credited wallet amount is `OrderItem.meta.amountKopecks` or `variant.attributes.amountRub`.
- Server actions (`src/server/cart/actions.ts`): `addToCart({productId, variantId?, quantity, meta?})`, `updateQty({itemId, quantity})`, `removeFromCart({itemId})`, `updateCartItemMeta({itemId, steamLogin?|buyerInput?})`, `getCart() → CartView`. Client button: `components/cart/add-to-cart-button.tsx` (`<AddToCartButton productId variantId? meta? buyNow? />`). Zone A's `addItemToCart` bridge writes the same tables and is accepted as-is.

**Orders** (`@/server/orders`)
| Function | Notes |
|---|---|
| `createOrderFromCart({userId,email,promoCode?,ip?,userAgent?,paymentMethod?}) → {id,number,total,subtotal,discount}` | throws `CheckoutError(code)`; one tx: order+items (commission snapshot), promo allocation, `FOR UPDATE SKIP LOCKED` stock reservation. Does **not** clear the cart (done after payment initiation succeeded) |
| `validatePromo(code,userId,subtotal,lineCount)` | pure rules in `pricing.ts#computePromoDiscount`; an order can never become free (≥ 1 ₽ per line) |
| `transitionOrder(tx, order, to, data?)` | the ONLY writer of `Order.status` (state machine + compare-and-set); `canTransition/assertTransition/deriveOrderStatus` in `state-machine.ts` |
| `markPaid(paymentId, {reportedAmount?, raw?})` / `markPaidTx(tx,…)` | idempotent settle (`already` outcome), row-locks Payment+Order, amount check (`AmountMismatchError`), ledger postings, promo `usedCount++`, **`Product.salesCount`/`SellerProfile.salesCount += qty` (the worker must NOT increment them again)**, then `afterMarkPaid` (analytics `purchase`, notifications, `dispatchFulfillment`) |
| `dispatchFulfillment(orderId)` | `enqueueJob('fulfill_order')`; on failure → `fulfillOrderInline` |
| `fulfillOrderInline(orderId)` | fallback delivery: AUTO_STOCK → stock SOLD + item DELIVERED (+`holdReleaseAt = now + holdDays`); AUTO_PROVIDER only with the mock supplier (labelled `provider:"mock", sandbox:true`), real supplier left PROCESSING for the worker; MANUAL → PROCESSING + seller notification. **Locks the `Order` row `FOR UPDATE`; the worker's `fulfill_order` must do the same and skip items that are no longer PENDING/PROCESSING** |
| `sweepStuckPaidOrders(sec=45)`, `expirePendingOrders(min=30)`, `releaseExpiredReservations()` | housekeeping (see route above) |
| `cancelOrder(orderId,{buyerId?})` | PENDING → CANCELLED, releases stock, cancels open payments |
| `refundOrder(orderId,{actor:{id}\|"system", orderItemIds?, reason?, ip?})`, `refundOrderItem(orderItemId, opts)` | **admin/dispute resolution calls this** (re-verifies ADMIN in DB; caller must still `assertRole("ADMIN")`). REFUND ledger posting to the buyer's site balance, partial refunds supported (order → REFUNDED when no live item remains), undelivered stock returns to the pool, open disputes → `RESOLVED_REFUND`, audit `order.refund`, buyer notification |
| `getOrderDelivery(orderId,buyerId) → DeliveredItem[]\|null` | server-side decrypted keys for the buyer's own order (zone C: use on `/account/orders/[id]`) |

**Ledger** (`@/server/ledger`): pure `accounts.ts` (`assertBalanced`, `topupLines`, `purchaseLines`, `refundLines`, `holdReleaseLines`, `payoutLines`, `payoutReversalLines`, `cacheDeltas`, `balanceOfLines`) and DB `ledger.ts`: `postLedger(tx, {kind, lines, orderId?, orderItemId?, paymentId?, payoutId?, memo?})` (balanced check + cached-balance update in the SAME tx; `InsufficientFundsError` when `User.balance`/`SELLER_AVAILABLE`(payout) would go negative; zero-amount lines are dropped), `getBalance(account, ownerId?)`, `verifyLedgerIntegrity()` (unbalanced txIds + cache-vs-ledger mismatches; used by tests). Zone C payouts: `postLedger(tx, {kind:"PAYOUT", lines: payoutLines(sellerId, amount), payoutId})` inside the same tx that creates the `Payout` row.

**Payments** (`@/server/payments`)
- `PaymentProvider { createPayment, verifyWebhook(rawBody, headers), getStatus, isConfigured }` — `PlategaProvider`, `RollyPayProvider`, `SandboxProvider` (built from env in `config.ts#getProvider`). `listPaymentMethods({forTopup?})` gives availability for UIs (keys configured + `Setting payments.enabled`).
- `startOrderPayment({orderId,userId,choice})`, `payOrderWithBalance(orderId,userId)` (one tx: guarded debit, `InsufficientFundsError` → nothing persisted), `startBalanceTopup(...)`; webhook pipeline `handleWebhook(provider, rawBody, headers)` = verify signature → `WebhookEvent` dedupe → Redis lock `payment:{provider}:{externalId}` → amount check → `markPaid`; `reconcilePayment(paymentId)` polls `getStatus` (used by the success-page poller, throttled 5 s).
- **Balance top-up for zone C**: `import { createBalanceTopup } from "@/server/payments/actions"` → `await createBalanceTopup({ amount: <kopecks 10 000..10 000 000>, method: "SANDBOX" | "PLATEGA_SBP" | "PLATEGA_CARD" | "ROLLYPAY" })` → `{ ok: true, data: { redirectUrl, paymentId } }` (client does `window.location.href = redirectUrl`). Limits in `payments/constants.ts`. Offer only methods from `listPaymentMethods({ forTopup: true })`. After payment the buyer lands on `/checkout/success?payment=<id>` (poller) and the webhook credits `User.balance`.
- Pay an existing PENDING order: link to `/checkout/pay/{orderId}`.
- Pages: `/cart`, `/checkout`, `/checkout/pay/[orderId]`, `/checkout/sandbox/[paymentId]` ("ТЕСТОВЫЙ РЕЖИМ"; Оплатить/Отклонить → signed webhook through the real pipeline), `/checkout/success?order=|payment=` (shows real DB state + decrypted keys, polls until delivered; a gateway redirect is never trusted), `/checkout/fail?order=|payment=`.
- Analytics emitted: `add_to_cart`, `remove_from_cart`, `begin_checkout`, `add_payment_info`, `purchase` (server, on settle), `topup_balance`.

### 20-C Cabinets

Implemented in `apps/web/src/app/{account,seller}`, services `apps/web/src/server/cabinet/*`, components `apps/web/src/components/cabinet/*`, poll route `app/api/cabinet/disputes/[id]/messages`. Service-level integration tests: `bash scripts/test-int-cabinet.sh` (reseeds the throw-away `asapawge_test` DB, 13 tests: keys, stock, manual delivery, reviews, disputes, payouts/ledger, product lifecycle, account, seller stats). Playwright specs (not runnable in the sandbox): `apps/web/e2e/cabinet.spec.ts`.

**Routes.** `/account` (overview + notifications) · `/account/orders` · `/account/orders/[id]` (timeline, reveal keys, review, dispute) · `/account/topup` (`/account/balance` redirects here — header/payment pages still link to it) · `/account/transactions` (USER_BALANCE ledger) · `/account/favorites` · `/account/reviews` · `/account/disputes[/id]` · `/account/api-keys` · `/account/settings` · `/account/become-seller`. `/seller` (KPIs, 30-day Recharts chart, hold vs available) · `/seller/products[/new|/[id]/edit|/[id]/stock]` · `/seller/stock` · `/seller/orders` (`?filter=manual|all|delivered|refunded`) · `/seller/reviews` · `/seller/disputes[/id]` · `/seller/payouts` · `/seller/analytics?days=7|30|90` · `/seller/api-keys` · `/seller/settings`.

**Seller profile rules.** Sellers need a `SellerProfile`; ADMIN without one is redirected to `/admin`. `PENDING` (also the sign-up-as-seller path, role SELLER) may create drafts, upload stock, deliver orders; **submitting a product for moderation and requesting payouts require `VERIFIED`**; `REJECTED`/`SUSPENDED` are read-only. USER application (`/account/become-seller`) creates `SellerProfile(PENDING)` and keeps role USER — **admin approval must set `status=VERIFIED` + `User.role=SELLER`** (zone D does this in `reviewSeller`); a `REJECTED` applicant may resubmit (back to `PENDING`). Sellers (ADMIN included) only touch rows with `sellerId === user.id` in the seller cabinet.

**Products.** `saveProduct` (`server/cabinet/products.ts`): `intent: "draft" | "submit"`. Submit → `PENDING_REVIEW`, clears `aiModeration`/`moderationNote`, then `enqueueJob("ai_moderate_product", { productId })` (if the worker is down the product simply waits in the admin queue). Editing an `ACTIVE` product: price-only changes stay `ACTIVE`; changing title/description/category/type/platform/region/images/instructions/variant titles sends it back to `PENDING_REVIEW` (re-moderation). `Product.price` = min active variant price (`oldPrice` = that variant's old price); removed variants with orders/stock are deactivated, others deleted. Seller delivery modes: `AUTO_STOCK`, `MANUAL` only (AUTO_PROVIDER and Steam `TOPUP` are platform-run). Activation steps are stored as `attributes.activation: string[]` (zone A renders them). **Seller image URLs must be https on hosts allow-listed in `next.config.ts` (`server/cabinet/images.ts` mirrors the list) — add new hosts to both.** Archive / restore (→ `DRAFT`) / delete (only never-sold products).

**AI description (needs zone F).** Seller form button «AI: сгенерировать описание» → server action `describeProductAction` → `POST {WEB_INTERNAL_URL}/api/ai/describe` forwarding the seller's session cookie:
`{ title, type, deliveryMode, platform?, region?, categoryName?, notes?, language: "ru" } → { ok: true, data: { description, shortDescription?, tags?: string[], provider?, mock?: boolean } }` (F: authenticate with `assertRole("SELLER","ADMIN")`, log to `AiLog` task `describe`). If the endpoint is absent/fails the action falls back to a clearly-labelled local template (`source: "template"`).

**Stock.** `uploadStock`: trims, dedupes (sha256 fingerprint, within the batch and against the product's existing stock, also sold keys), rejects empty / >4000 chars, ≤5000 per call, encrypts with `encryptStock` (§11); variant required iff the product has active variants. UI parses textarea lines or a CSV/TXT (first column, header row skipped) in the browser. Unsold list shows masked previews (decrypted server-side only to build the mask); `deleteUnsoldStock` deletes `AVAILABLE` rows only.

**Manual delivery.** `deliverManualItem`: seller of the item, `deliveryMode = MANUAL`, item `PENDING|PROCESSING`, order `PAID|PROCESSING` → item `DELIVERED`, `deliveryData = { mode: "MANUAL", message, deliveredBy }`, `holdReleaseAt = now + holdDays`, order advanced through `deriveOrderStatus` + `transitionOrder`, buyer notified (`ORDER_DELIVERED`).

**Buyer keys.** Plaintext never ships in the page HTML: `/account/orders/[id]` shows «Показать», which calls `revealItemSecretsAction(orderItemId)` → `getOrderDelivery(orderId, user.id)` (ownership in the query, 60/min rate limit). Reuses `components/commerce/secret-list.tsx`.

**Reviews.** `createReview(buyerId, {orderItemId, rating 1–5, text?})`: item `DELIVERED`, order `DELIVERED|DISPUTED`, one per item (unique `orderItemId`), status `PUBLISHED`; recomputes `Product.ratingAvg/ratingCount` and `SellerProfile.rating/ratingCount` from `PUBLISHED` reviews (`recomputeRatings(productId, sellerId)` — **zone D / worker should call it after hiding or restoring a review**), enqueues `ai_moderate_review`, tracks `review_submit`, notifies the seller (`REVIEW_NEW`). Seller replies via `replyToReview` (`Review.reply/repliedAt`, editable).

**Disputes** (`server/cabinet/disputes.ts`, `dispute-actions.ts`). Open: item `DELIVERED`, order `DELIVERED`, ≤ 14 days after delivery, no active dispute on the item → `Dispute(OPEN)` + first `DisputeMessage` (buyer's reason) + `SYSTEM` message, order `DELIVERED → DISPUTED` (via `transitionOrder`), notifies seller and all admins, tracks `dispute_open`. Chat: `postDisputeMessage` (buyer / the dispute's seller / **ADMIN**; `authorRole` = USER|SELLER|ADMIN, `SYSTEM` for notices): seller reply `OPEN → SELLER_REPLIED`, buyer follow-up `SELLER_REPLIED → OPEN`; `escalateDispute` (buyer or seller) → `ESCALATED`; `closeDisputeByBuyer` → `CLOSED` and, when no other active dispute remains, order `DISPUTED → DELIVERED`. Writable statuses: `OPEN|SELLER_REPLIED|ESCALATED` (`ACTIVE_DISPUTE_STATUSES`). Polling: `GET /api/cabinet/disputes/:id/messages?after=<ISO>` → `{ ok, data: { messages[], status, canPost } }` every 5 s, access = buyer | seller | ADMIN, 60 req/min. **Zone D can embed the same UI**: `<DisputeChat disputeId initialMessages initialStatus viewerId viewerRole="ADMIN"/>` (`components/cabinet/dispute-chat.tsx`) + `listDisputeMessages(adminUser, id)`; resolving (refund / reject) stays in D (`refundOrder`, then set `Dispute.status = RESOLVED_*`, `resolution`, `resolvedAt`, and move the order `DISPUTED → DELIVERED` when rejecting).

**Payouts** (`server/cabinet/payouts.ts`). `requestPayout`: seller `VERIFIED`, amount ≥ `MIN_PAYOUT_KOPECKS`, ≤ available, ≤ 3 open requests; methods `CARD` (Luhn), `SBP` (phone+bank), `USDT` (address+network), `YOOMONEY`; one tx = `Payout(REQUESTED)` + ledger `PAYOUT` (`payoutLines`, guarded decrement → concurrent requests cannot overdraw); last-used details saved in `SellerProfile.payoutDetails`. `cancelPayout` (own `REQUESTED` only, compare-and-set) posts `PAYOUT_REVERSAL`. Admin (zone D) processes: `PAID` (no entries) or `REJECTED` (+ `payoutReversalLines`).

**API keys UI** (`server/cabinet/api-keys.ts`; shared by `/account/api-keys` and `/seller/api-keys`): `createApiKey(user, {name, scopes, expiresInDays?})` — scopes must be ⊆ `ROLE_SCOPES[user.role]`, ≤ 10 active keys, key = `generateApiKey()`, only `hash` + `prefix` stored, full key shown once; `revokeApiKey` sets `revokedAt`; `listApiKeys` never returns hashes. Verification (`hashApiKey` lookup, expiry/revoked/banned checks, effective role) belongs to zone F.

**Seller stats** (`server/cabinet/seller-stats.ts`): sales = `OrderItem` of orders with `paidAt` and status ∈ {PAID,PROCESSING,DELIVERED,DISPUTED}, item ≠ REFUNDED; days bucketed in Europe/Moscow; revenue = Σ `OrderItem.total`, "к получению" = Σ `sellerEarning`; conversion = paid orders / `view_item` analytics events on the seller's products (null without views).

### 20-D Admin & analytics
**Guards.** `/admin/layout.tsx` calls `requireRole("ADMIN")`; every page repeats it and every server action goes through `adminAction()` (`server/admin/action.ts`): `assertRole("ADMIN")` against the DB, 120 mutations/min/admin rate limit, zod `parseInput`, `{ ok, data } | { ok:false, error, fieldErrors }` envelope. Mutations call `audit(tx, ctx, {...})` inside the same transaction, so state change and `AuditLog` row commit together (action names: `user.role|ban|unban|balance_adjust`, `settings.update`, ...).

**Services** (`server/admin/*`): users (role / ban / balance adjust = balanced `ADJUSTMENT` ledger posting from `EXTERNAL` or `PLATFORM_FEE`), sellers, products (moderation queue + AI verdict from `AiLog`), orders (manual deliver, refund through zone B `refundOrder`), disputes (admin reply, refund / reject resolution), payouts (`APPROVED` -> `PAID`, `REJECTED` posts `payoutReversalLines`), categories, promocodes, settings (`loadSettings` / `saveSettings`, sections `commission|ai|analytics|payments`, keys from `SETTING_KEYS`), ai (`generateAdminText` bridge, every call logged to `AiLog`).

**Pages**: `/admin` (KPIs + charts, `?period=7|30|90`), `/admin/analytics` (traffic & events), `/admin/users`, `/sellers`, `/products` (moderation queue, `/products/[id]` edit), `/orders` (+ `[id]`), `/disputes` (+ `[id]`, embeds `DisputeChat`), `/payouts`, `/categories`, `/promocodes`, `/settings`, `/audit`, `/ai-logs`. `/admin/moderation` and `/admin/ai` are redirects kept for old links.

**Metrics** (`server/analytics/metrics.ts`): `getDashboardMetrics(days)` -> KPIs with previous-period deltas (GMV, net revenue = platform fees, orders, paid conversion, AOV, new users, active sellers, refund rate), daily series, by category, payment share, funnel (`page_view -> view_item -> add_to_cart -> begin_checkout -> purchase`), top products/sellers, DAU/MAU, weekly cohort retention. SQL aggregates via `$queryRaw`, Redis cache `cache:analytics:*` for 5 min, prefers `DailyMetric` snapshots for closed days when present (`snapshotDays` tells how many were used). Days are bucketed in Europe/Moscow. AI summary: `server/analytics/summary.ts` (Russian text; deterministic fallback when no AI key).

**Tracking.** First-party: `POST /api/track` (alias of `/api/analytics/event`): body `{ name, path?, sessionId?, properties? }`, name in `ANALYTICS_EVENTS` (aliases `product_view` -> `view_item`, `pageview` -> `page_view`), rate-limited, bots and `/admin`, `/api/*` paths are skipped (`{ tracked:false, reason }`). Client: `components/analytics` (`<Analytics/>` in the root layout: page_view on every route change, `useTrack()` hook, `track()` helper). Yandex Metrika: `components/analytics/yandex-metrika.tsx` loads `tag.js` only when a counter id is set (`NEXT_PUBLIC_YM_ID` or `Setting("analytics.ymId")`), webvisor + clickmap + ecommerce `dataLayer`, SPA hits through `usePathname`; helpers in `lib/metrika.ts` (`reachGoal`, `pushEcommerce`, `pushPurchase`, `hit`). Admin screens carry `ym-hide-content`.

**Tests**: `server/admin/admin.int.test.ts` (real DB, run by `bash scripts/test-int.sh`): balance credit/debit + ledger + audit, overdraft refusal, self-ban/role guards, ban/unban, settings validation + audit. `server/analytics/metrics.live.test.ts` (`LIVE_DB=1`).

### 20-E Worker

Code: `apps/worker/app` (`main.py` FastAPI, `worker.py` arq `WorkerSettings`, `jobs/*` pure `*_impl(factory, …)` functions, `ai/*`, `providers/steam.py`, `ledger.py`, `models.py` = SQLAlchemy mapping of the Prisma tables). Run: `pnpm worker:dev` (API :8000), `pnpm worker:queue` (arq consumer), or both with `pnpm dev:worker`. Tests: `pnpm worker:test` (90 tests; DB tests run on a throw-away `asapawge_worker_test` DB migrated from the real Prisma SQL and are skipped when Postgres is down).

**Endpoints** (auth: `Authorization: Bearer $WORKER_INTERNAL_TOKEN` or `X-Internal-Token`): `GET /health` (open) · `GET /health/deep` (DB+Redis) · `POST /internal/jobs/{name}` body `{args, delaySeconds?}` -> `202 {ok, jobId, duplicate}` (args validated by zod-equivalent pydantic schemas in `job_names.py`; 401 bad token, 404 unknown job, 422 bad args; `fulfill_order` uses job id `fulfill_order:{orderId}` so duplicate triggers collapse) · `POST /internal/steam/check-login {login}` -> `{ok, displayName?, reason?, source}`.

**Jobs** (`job_names.JOB_ARGS`): the §10 table plus `ai_dispute_suggestion {disputeId}` (writes `AiLog` + `Dispute.aiSuggestion` JSON), `sweep_stuck_paid_orders` (cron, fulfils PAID orders older than 45 s), `sync_pending_payments` (cron, polls provider for stale PENDING payments; sandbox/balance skipped), and the alias `ai_fraud_score_order` == `ai_score_fraud`. Cron: `release_holds` /10 min, `expire_reservations` /5 min, `aggregate_daily_metrics` hourly (today + yesterday; `{date}` arg for backfill), sweep every 2 min, payments sync every 5 min.

**Ledger**: the worker never posts PURCHASE/TOPUP (web `markPaid` owns them). It posts `HOLD_RELEASE` (cron) and `REFUND` (auto-refund of a failed item to the buyer balance, only when a PURCHASE for the item exists and no REFUND yet; idempotent). Every posting is balanced and updates the cached balances in the same transaction, with the same account semantics as §8. `Product/SellerProfile.salesCount` are not touched (web does it).

**Fulfilment**: locks the `Order` row `FOR UPDATE` (compatible with web `fulfillOrderInline`), skips items not PENDING/PROCESSING. AUTO_STOCK: takes the RESERVED rows linked to the item (tops up from AVAILABLE with `SKIP LOCKED`), verifies AES-GCM integrity, marks SOLD, item DELIVERED + `holdReleaseAt`. AUTO_PROVIDER: calls the `TopupProvider` outside the DB tx (`topup(login, amount_rub, ref=OrderItem.id)` / `status(ref, tx_id)`), arq retry with backoff for transient errors, timed-out pending top-ups are flagged to admins; hard failure -> item FAILED -> auto-refund (disable via `Setting("worker.autoRefundOnFailure")=false`). MANUAL: item PROCESSING + `ORDER_PAID` notification to the seller. Order status is derived from items (`state.py`), buyer gets `ORDER_DELIVERED`/`ORDER_FAILED`.

**TopupProvider (Python)**: `check_login(login) -> LoginCheck(ok, display_name, reason, source)`, `topup(login, amount_rub, ref) -> TopupResult(status completed|pending|failed, tx_id, message)`, `status(ref, tx_id)`. `STEAM_TOPUP_PROVIDER=mock` (default, deterministic, results labelled `provider:"mock", sandbox:true`; logins containing `invalid|notfound|nouser` fail) or `http` (`STEAM_TOPUP_API_URL/KEY`; request shape documented in `providers/steam.py` — verify against the supplier docs).

**AI** (`app/ai`): providers OpenAI / Anthropic / OpenRouter (`https://openrouter.ai/api/v1`) selected by `Setting(ai.provider)` ▸ `AI_PROVIDER`, fallback chain over configured providers, then the offline heuristic provider (results labelled `mock:true`). Every call writes `AiLog`. Moderation: score ≥ `Setting(ai.autoPublishThreshold)` (80) and verdict approve -> `ACTIVE`, reject -> `REJECTED`, else stays `PENDING_REVIEW`; verdict JSON `{approved, score, reasons, suggested_category, verdict}` is stored in `Product.aiModeration`. Reviews: flags in `Review.aiFlags`, may HIDE (the web `recomputeRatings` should be run by admin/UI after hide). Fraud: `Order.fraudScore`.

### 20-F AI + MCP + API

**API-key helpers** (`src/server/api-keys`, barrel `index.ts`): `authenticateApiKey(req) -> {ok, principal{keyId,keyPrefix,role,scopes,user}, rate} | {ok:false,status,code,message}`; `apiRoute({scope}, handler)` wraps a `/api/v1` route (auth -> scope -> handler, masks 500s, adds `X-RateLimit-*`); `throw new ApiHttpError(status, code, message, details?)` inside handlers; pure helpers `extractApiKey / minRole / effectiveScopes / keyRejection / hasScope` (unit-tested). Key creation/revocation for the UI lives in `server/cabinet/api-keys.ts` (zone C). Rate limit: 120 req/min per key; `POST /orders` additionally 30/hour/user.

**REST v1** (all JSON `{ok,data}` / `{ok:false,error}`; money in kopecks): `GET /me`, `GET /balance` (orders:read), `GET /categories`, `GET /products`, `GET /products/{id|slug}` (catalog:read), `GET|POST /orders` (orders:read / orders:create — pay from balance; `Idempotency-Key`; 402 `insufficient_funds`), `GET /orders/{id|number}` (includes decrypted `items[].delivery.secrets` for the buyer), `POST /seller/products` (seller:products; reuses cabinet `saveProduct`), `POST /seller/products/{id}/stock` (seller:stock), `GET /seller/stats` (seller:stats), `GET /admin/metrics?days=7|30|90&summary=1` (admin:metrics), `POST /admin/products/{id}/moderate` (admin:moderate, audited). OpenAPI 3.1: `GET /api/v1/openapi.json` (no auth, built in `server/api-v1/openapi.ts` from the same zod schemas). Docs page: `/developers`.

**AI** (`src/server/ai`): `LLMProvider { name, isConfigured(), defaultModel(), chat(messages, opts), stream(messages, opts) }` with `OpenAiCompatibleProvider` (OpenAI + OpenRouter via `openai` SDK), `AnthropicProvider` (`@anthropic-ai/sdk`, default `claude-sonnet-5-5`; never sends `temperature`), `MockProvider` (deterministic intent router, `mock:true`). `getAiSelection()` = `Setting(ai.provider|ai.model)` then `AI_PROVIDER|AI_MODEL`; `buildChain` orders selected provider first, then other configured ones. `complete()/streamComplete()` walk the chain and write one `AiLog` row per attempt (task = `describe | moderation | metrics_summary | support_chat`). Tasks return `AiMeta {provider, model, mock}`; with no usable provider they fall back to `heuristics.ts` (rule-based moderation, template descriptions). Entry points: `generateProductDescription`, `moderateProductContent`, `summarizeMetrics`, `runSupportAgent`.
Routes: `POST /api/ai/describe` (SELLER/ADMIN session, rate-limited), `POST /api/ai/chat` (SSE: `{"type":"text","delta"} | {"type":"tool","name"} | {"type":"done","mock","provider"} | {"type":"error","message"}`; guests get `search_products` + `get_faq`, signed-in users also `get_order_status` (own orders only) and `create_support_ticket` -> Dispute + Message). Widget: `components/support-chat` mounted in the root layout.

**MCP** (`apps/mcp`): stateless Streamable HTTP `POST /mcp` (+ `/health`), stdio entry (`ASAP_API_KEY`); `KeyVerifier` validates the key against `GET /me` and registers only the tools its scopes allow; all calls go to `MCP_API_BASE_URL` with the caller's own key. Smoke test: `pnpm --filter @asap/mcp smoke`. No schema changes in zone F.

### Schema change log
| date | zone | change | migration |
|---|---|---|---|
| 2026-10-16 | foundation | initial schema | `20261016151747_init` |
| 2026-10-16 | A | none (new Setting key `steam_topup_fee_percent`, seeded as `4`) | — |
| 2026-10-16 | C | none (cabinets use the existing schema only) | — |
| 2026-10-17 | F | none (AI/API/MCP use existing `ApiKey`, `AiLog`, `Setting`, `Dispute`) | — |

---------------------------------------------------------------------------------------------------

## 21. Integration & verification (final pass)

- **Generated artwork**: seeded products/sellers use `/api/art/<slug>/<cover|avatar|1|2|3>` (SVG route handler, `app/api/art/[slug]/[variant]/route.ts`); `next.config.ts` sets `images.dangerouslyAllowSVG` for it and `isAllowedImageUrl` accepts that path. No third-party image host is required to run the demo. Seller-supplied images still must be https URLs on the allow-listed hosts.
- **Support-chat overlay**: the widget container is `pointer-events-none`; only the launcher and the *open* panel receive pointer events (a closed panel used to swallow clicks on the bottom-right of every page).
- **Layout**: `.grid` without explicit columns gets `grid-template-columns: minmax(0, 1fr)` (globals.css base layer) so tables/charts cannot stretch mobile pages; `DashboardShell` uses `minmax(0,1fr)` columns; `html` has `scroll-padding` for the sticky header / chat button.
- **Time zones**: Prisma stores UTC wall-clock in `timestamp(3)`; to group by Moscow day use `((col AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow')::date` (seller stats). Admin analytics group by UTC day (labelled "UTC").
- **Scripts**: `scripts/verify.sh` (= `pnpm verify`), `scripts/dev-stack.sh start|stop|status` (web prod + worker API + arq + MCP, logs in `.run/`), `scripts/check-ledger.sh` (ledger invariants), `scripts/test-int*.sh` (throw-away `asapawge_test` DB).
- **E2E**: `apps/web/e2e/{flows,commerce,cabinet,smoke}.spec.ts`; helpers in `e2e/helpers.ts` (`resetRateLimits()` clears Redis `rl:*` so repeated runs do not hit sign-up/login limits; `addToCart()` waits for the toast — navigating before the add-to-cart server action finishes drops the item). Browser path via `PW_CHROMIUM_PATH`. `e2e/screenshots.mjs` regenerates `docs/screenshots/*`.
- **Single implementations** (no duplicates left): analytics ingest = `POST /api/analytics/event` (`/api/track` is a re-export alias); Metrika client helpers = `lib/metrika.ts` (+ `components/analytics/*` for the counter script); API keys = `server/cabinet/api-keys.ts` (create/list/revoke UI) + `server/api-keys/*` (verification for `/api/v1` and MCP) over the shared `generateApiKey`/`hashApiKey`; Steam top-up adapters exist once per runtime (TS `server/topup/provider.ts` for login check + inline fallback, Python `providers/steam.py` for the worker) with identical mock rules.

---------------------------------------------------------------------------------------------------

## 22. Security review (adversarial pass) — what is enforced and where

Findings of the review that changed contracts (all covered by tests: `src/server/security.int.test.ts`, `e2e/security.spec.ts`, `apps/worker/tests/test_ai.py`, unit tests next to the code):

- **Client IP** (`lib/request.ts`): `X-Forwarded-For` is only trusted through `TRUSTED_PROXY_HOPS` (default 1 = the entry the nearest reverse proxy appended, i.e. the N-th from the RIGHT). The left-most entry is client-controlled and is never used. Values that are not IP-shaped become `unknown`. The MCP server forwards the caller's address in `x-forwarded-for` so REST limits apply per caller.
- **Rate limits** (`lib/rate-limit.ts`): a counter without TTL (crash between INCR and EXPIRE) is repaired on the next hit; failed `/api/v1` authentications are throttled per IP (30/min).
- **Production boot guard** (`instrumentation.ts` → `server/startup-checks.ts`): a PUBLIC production deployment (APP_URL not localhost) refuses to start with the `.env.example` secrets (`AUTH_SECRET`, `WORKER_INTERNAL_TOKEN`, `STOCK_ENCRYPTION_KEY`) or with a real payment gateway + `STEAM_TOPUP_PROVIDER=mock`. Override on staging only: `ALLOW_INSECURE_DEFAULTS=1`.
- **Sandbox payments** (`payments/config.ts`): on a public production host the sandbox is OFF unless `SANDBOX_WEBHOOK_SECRET` is set to a private value (>= 16 chars); the default dev secret would let anyone forge "payment succeeded" webhooks.
- **Promo codes**: `maxUses` counts unpaid (PENDING) orders as reservations and checkout locks the `PromoCode` row (`FOR UPDATE`) before re-validating, so parallel checkouts cannot exceed `maxUses` / `perUserLimit`.
- **Stock hoarding**: at most `MAX_PENDING_ORDERS` (5) unpaid orders per buyer. Products of SUSPENDED / REJECTED sellers cannot be bought.
- **Lock order** is always `Order` → `Payment` / `OrderItem` / `StockItem` (markPaid, cancel, refund, balance pay). `markPaidTx` locks the reserved `StockItem` rows so the `expire_reservations` sweep cannot free them mid-payment; `refundOrder` locks the order's `OrderItem` rows so `holdReleased` is read consistently against the worker's `release_holds`.
- **DB guards** (migration `20261017120000_integrity_guards`): partial unique indexes allow ONE `PURCHASE`, ONE `REFUND` and ONE `HOLD_RELEASE` posting per `OrderItem`; CHECK constraints keep payment/payout amounts > 0 and order/item/product money >= 0, commission 0..10000 bps.
- **Secrets never rendered into pages**: delivered keys are fetched only through `revealItemSecretsAction` (owner check + rate limit) — the checkout success page no longer embeds them in HTML/RSC payload.
- **Analytics ingest**: browsers may only report `CLIENT_EVENT_NAMES`; `sign_up/login/topup_balance/review_submit/dispute_open` are server-only, and a client `purchase` is accepted only for the signed-in buyer's own PAID order.
- **AI moderation**: `apply_hard_rules()` (worker) runs after the LLM — prohibited-content patterns force `reject`, contacts/off-platform links cap `approve` to `review` — so a prompt-injected listing cannot auto-publish.
- **Admin product edit** uses the same image allow-list as sellers (`cabinet/images.ts`); `/api/art/*` is `force-dynamic` (no unbounded prerender cache) and served with a sandboxing CSP.
- **Deployment**: `docker-compose.yml` publishes Postgres / Redis / worker only on `127.0.0.1`; sandbox secret has no default; `.gitignore` covers every `.env.*` except `.env.example`.

Known, accepted limitations: JWT sessions are not revoked on password change (they are re-validated against `banned`/`role` on every request); gateway webhooks without an `amount` field are accepted on signature alone (provider field names are unverified, see §9); no CSP header for the HTML pages (inline theme/Metrika scripts would need nonces).
