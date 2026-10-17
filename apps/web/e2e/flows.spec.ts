import { expect, test } from "@playwright/test";
import { DEMO, addToCart, createApiKeyViaUi, login, paySandbox, postSandboxWebhook, signUp, sql } from "./helpers";

/**
 * Full-stack flows against the running production stack (web + worker + Postgres + Redis + MCP) and a seeded DB.
 * See apps/web/playwright.config.ts for how to run. Every test creates its own data (fresh users / orders).
 */

test("(a) guest browses home -> catalog -> product", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Хиты продаж" })).toBeVisible();
  await page.getByRole("link", { name: /Весь каталог|Смотреть все/ }).first().click();
  await page.waitForURL(/\/catalog/);
  const firstProduct = page.locator('a[href^="/product/"]').first();
  await expect(firstProduct).toBeVisible();
  await firstProduct.click();
  await page.waitForURL(/\/product\//);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: /В корзину|Нет в наличии|Выбрать/ }).first()).toBeVisible();
  // unknown product is a real 404
  const res = await page.goto("/product/this-does-not-exist");
  expect(res?.status()).toBe(404);
});

test("(b) user tops up the balance (sandbox), buys a key with the balance and sees it in the cabinet", async ({ page }) => {
  await signUp(page, "/account");
  // top up 1000 RUB through the sandbox gateway
  await page.goto("/account/topup");
  await page.locator('label:has-text("Тестовая оплата")').click();
  await page.getByRole("button", { name: /Пополнить на/ }).click();
  await paySandbox(page);
  await page.waitForURL(/checkout\/success/);

  await addToCart(page, "stardew-valley");
  await page.goto("/cart");
  await expect(page.getByText("Stardew Valley").first()).toBeVisible();
  await page.getByRole("link", { name: /Оформить заказ/ }).click();
  await page.waitForURL((u) => u.pathname === "/checkout");
  await page.locator('label:has-text("Баланс")').first().click();
  await page.getByRole("button", { name: /^Оплатить/ }).click();
  await page.waitForURL(/checkout\/success/);
  await expect(page.getByRole("heading", { name: "Заказ выдан!" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("link", { name: "Открыть заказ" }).click();
  await page.waitForURL(/\/account\/orders\//);
  const html = await page.content();
  expect(html).not.toMatch(/[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z0-9]{5}/); // secrets are not in the server-rendered HTML
  await page.getByRole("button", { name: "Показать" }).first().click();
  await expect(page.locator("code").first()).toHaveText(/\S{8,}/);
  await expect(page.getByRole("button", { name: "Скопировать" }).first()).toBeVisible();
});

test("(c) sandbox payment: signed webhook path moves the order PAID -> DELIVERED; forged webhook is rejected", async ({ page, request }) => {
  await signUp(page, "/account");
  await addToCart(page, "stardew-valley");
  await page.goto("/cart");
  await page.getByRole("link", { name: /Оформить заказ/ }).click();
  await page.waitForURL((u) => u.pathname === "/checkout");
  await page.locator('label:has-text("Тестовая оплата")').click();
  await page.getByRole("button", { name: /Перейти к оплате/ }).click();
  await page.waitForURL(/checkout\/sandbox\/(.+)/);
  const paymentId = page.url().split("/").pop()!;
  const row = sql(`select "externalId" || '|' || amount::text || '|' || "orderId" from "Payment" where id='${paymentId}'`).split("|");
  const [externalId, amount, orderId] = [row[0]!, Number(row[1]), row[2]!];

  // forged signature => 401, nothing changes
  const forged = await request.post("/api/payments/webhook/sandbox", { data: JSON.stringify({ eventId: "forged", externalId, status: "PAID", amount }), headers: { "content-type": "application/json", "x-signature": "00".repeat(32) } });
  expect(forged.status()).toBe(401);
  expect(sql(`select status from "Order" where id='${orderId}'`)).toBe("PENDING");

  // wrong amount => 422
  const wrong = await postSandboxWebhook(request, { eventId: `e2e-wrong-${paymentId}`, externalId, status: "PAID", amount: amount + 1 });
  expect(wrong.status()).toBe(422);

  // valid signed webhook => PAID and then delivered by the worker (or the inline fallback)
  const ok = await postSandboxWebhook(request, { eventId: `e2e-ok-${paymentId}`, externalId, status: "PAID", amount });
  expect(ok.status()).toBe(200);
  await expect.poll(() => sql(`select status from "Order" where id='${orderId}'`), { timeout: 30_000 }).toBe("DELIVERED");
  // replay is idempotent
  const replay = await postSandboxWebhook(request, { eventId: `e2e-ok-${paymentId}`, externalId, status: "PAID", amount });
  expect(replay.status()).toBe(200);
  expect(sql(`select count(*) from "LedgerEntry" where "orderId"='${orderId}' and kind='PURCHASE'`)).not.toBe("0");

  await page.goto(`/account/orders/${orderId}`);
  await expect(page.getByText(/Выдан|Доставлен/).first()).toBeVisible();
});

test("(d) Steam top-up (mock supplier): invalid login is rejected, valid one is delivered", async ({ page }) => {
  await signUp(page, "/account");
  await page.goto("/steam");
  const loginInput = page.getByPlaceholder(/gaben_1998/);
  await loginInput.fill("invalid_user");
  await expect(page.getByText(/не найден/i).first()).toBeVisible({ timeout: 15_000 });
  await loginInput.fill("gabe_newell_e2e");
  await expect(page.getByText(/Аккаунт найден|найден/i).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Перейти к оплате/ }).click();
  await page.waitForURL((u) => u.pathname === "/checkout", { timeout: 30_000 });
  await page.locator('label:has-text("Тестовая оплата")').click();
  await page.getByRole("button", { name: /Перейти к оплате/ }).click();
  await paySandbox(page);
  await page.waitForURL(/checkout\/success/);
  await expect(page.getByRole("heading", { name: "Заказ выдан!" })).toBeVisible({ timeout: 45_000 });
  const login = sql(`select oi."deliveryData"::text from "OrderItem" oi join "Order" o on o.id=oi."orderId" join "User" u on u.id=o."buyerId" where u.email like 'e2e-%' order by o."createdAt" desc limit 1`);
  expect(login).toMatch(/mock_/);
});

test("(e) seller creates a product -> moderation -> admin approves -> visible in the catalog", async ({ browser }) => {
  const title = `E2E Game ${Date.now()}`;
  const sellerCtx = await browser.newContext();
  const seller = await sellerCtx.newPage();
  await login(seller, DEMO.seller.email, DEMO.seller.password, "/seller/products/new");
  await seller.getByLabel("Название", { exact: true }).fill(title);
  await seller.getByLabel("Полное описание").fill("Тестовая игра для проверки сквозного сценария: создание товара продавцом, модерация и публикация. Ключ Steam, регион СНГ, активация в клиенте Steam.");
  await seller.locator("#p-price").fill("777");
  await seller.locator("#p-category").click();
  await seller.getByRole("option").first().click();
  await seller.getByRole("button", { name: /Отправить на модерацию/ }).click();
  await seller.waitForURL(/\/seller\/products(\/.+\/edit)?$/, { timeout: 30_000 });
  const id = sql(`select id from "Product" where title='${title}'`);
  expect(id).not.toBe("");
  expect(["PENDING_REVIEW", "ACTIVE"]).toContain(sql(`select status from "Product" where id='${id}'`));
  await sellerCtx.close();

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await login(admin, DEMO.admin.email, DEMO.admin.password, "/admin");
  // give the worker's AI moderation a moment; then approve manually if it is still in the queue
  await admin.waitForTimeout(4000);
  if (sql(`select status from "Product" where id='${id}'`) !== "ACTIVE") {
    await admin.goto(`/admin/products?status=PENDING_REVIEW&q=${encodeURIComponent(title)}`);
    await admin.getByRole("button", { name: "Одобрить" }).first().click();
    await admin.getByRole("button", { name: "Опубликовать" }).click();
    await expect.poll(() => sql(`select status from "Product" where id='${id}'`), { timeout: 20_000 }).toBe("ACTIVE");
  }
  await adminCtx.close();

  const guestCtx = await browser.newContext();
  const guest = await guestCtx.newPage();
  const slug = sql(`select slug from "Product" where id='${id}'`);
  await guest.goto(`/product/${slug}`);
  await expect(guest.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await guest.goto(`/search?q=${encodeURIComponent(title)}`);
  await expect(guest.getByText(title).first()).toBeVisible();
  await guestCtx.close();
});

test("(f) admin dashboard renders charts with data", async ({ page }) => {
  await login(page, DEMO.admin.email, DEMO.admin.password, "/admin");
  await expect(page.getByText("Выручка и заказы")).toBeVisible();
  await expect(page.locator(".recharts-surface").first()).toBeVisible({ timeout: 20_000 });
  expect(await page.locator(".recharts-surface").count()).toBeGreaterThanOrEqual(3);
  // real data: area/line/bar paths with geometry
  await expect(page.locator(".recharts-area-area, .recharts-bar-rectangle, .recharts-line-curve").first()).toBeAttached();
  await page.getByRole("link", { name: /30 дн/ }).first().click().catch(() => {});
  for (const path of ["/admin/orders", "/admin/users", "/admin/products", "/admin/settings", "/admin/audit"]) {
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
  }
});

test("(g) REST API: API key lists products and creates an order from the balance", async ({ page, request }) => {
  await signUp(page, "/account");
  await page.goto("/account/topup");
  await page.locator('label:has-text("Тестовая оплата")').click();
  await page.getByRole("button", { name: /Пополнить на/ }).click();
  await paySandbox(page);
  await page.waitForURL(/checkout\/success/);
  const key = await createApiKeyViaUi(page, "e2e-key", ["catalog:read", "orders:read", "orders:create"]);
  const auth = { Authorization: `Bearer ${key}` };

  expect((await request.get("/api/v1/products")).status()).toBe(401);
  const me = await request.get("/api/v1/me", { headers: auth });
  expect(me.status()).toBe(200);
  const list = await request.get("/api/v1/products?pageSize=5", { headers: auth });
  expect(list.status()).toBe(200);
  const items = (await list.json()).data.items as { id: string; slug: string }[];
  expect(items.length).toBeGreaterThan(0);

  const spec = await request.get("/api/v1/openapi.json");
  expect((await spec.json()).openapi).toMatch(/^3\./);

  const keyProduct = await request.get("/api/v1/products/stardew-valley", { headers: auth });
  const prod = (await keyProduct.json()).data as { id: string; variants?: { id: string }[] };
  const order = await request.post("/api/v1/orders", { headers: { ...auth, "Idempotency-Key": `e2e-${Date.now()}` }, data: { items: [{ productId: prod.id, quantity: 1 }], paymentMethod: "BALANCE" } });
  expect(order.status(), await order.text()).toBe(201);
  const body = (await order.json()).data;
  expect(body.status).toBe("DELIVERED");
  expect(JSON.stringify(body)).toMatch(/secrets/);
  // scope enforcement: a buyer key must not reach admin endpoints
  expect((await request.get("/api/v1/admin/metrics", { headers: auth })).status()).toBe(403);
});

test("(h) MCP: client calls search_products with an API key", async ({ page, request }) => {
  await signUp(page, "/account");
  const key = await createApiKeyViaUi(page, "e2e-mcp");
  const mcp = process.env.MCP_URL ?? "http://localhost:3333/mcp";
  const headers = { "content-type": "application/json", accept: "application/json, text/event-stream", Authorization: `Bearer ${key}` };

  expect((await request.post(mcp, { headers: { ...headers, Authorization: "Bearer ak_live_bad" }, data: { jsonrpc: "2.0", id: 0, method: "tools/list" } })).status()).toBe(401);
  const tools = await request.post(mcp, { headers, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(tools.status()).toBe(200);
  const names = ((await tools.json()).result.tools as { name: string }[]).map((t) => t.name);
  expect(names).toContain("search_products");
  expect(names).not.toContain("admin_metrics"); // buyer key sees only buyer tools

  const call = await request.post(mcp, { headers, data: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "search_products", arguments: { query: "spotify", pageSize: 3 } } } });
  const result = (await call.json()).result as { content: { text: string }[]; isError?: boolean };
  expect(result.isError).toBeFalsy();
  const found = JSON.parse(result.content[0]!.text) as { items: { title: string }[] };
  expect(found.items.length).toBeGreaterThan(0);
});
