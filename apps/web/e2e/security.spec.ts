import { expect, test } from "@playwright/test";
import { createApiKeyViaUi, resetRateLimits, signUp, sql } from "./helpers";

/**
 * Black-box security regressions against the running stack (authz / IDOR / rate limiting / forged input).
 * Deeper money-race checks live in the DB-backed integration suite (src/server/security.int.test.ts).
 */

const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

test.afterAll(() => resetRateLimits());

test("guests and wrong credentials are rejected by every protected endpoint", async ({ request, page }) => {
  resetRateLimits();
  expect((await request.get("/api/v1/me")).status()).toBe(401);
  expect((await request.get("/api/v1/orders")).status()).toBe(401);
  expect((await request.get("/api/v1/me", { headers: { authorization: "Bearer ak_live_" + "0".repeat(48) } })).status()).toBe(401);
  expect((await request.post("/api/payments/maintenance")).status()).toBe(401);
  expect((await request.post("/api/payments/maintenance", { headers: { authorization: "Bearer nope" } })).status()).toBe(401);
  expect((await request.get("/api/cabinet/disputes/anything/messages")).status()).toBe(401);
  expect((await request.post("/api/ai/describe", { data: {} })).status()).toBe(401);
  // a webhook for an unconfigured / unknown gateway never reaches business logic
  expect((await request.post("/api/payments/webhook/nonexistent", { data: "{}" })).status()).toBe(404);
  expect((await request.post("/api/payments/webhook/sandbox", { data: "{}", headers: { "x-signature": "00" } })).status()).toBe(401);
  // back office is not reachable without a session
  await page.goto("/admin");
  await expect(page).toHaveURL(/sign-in/);
});

test("a buyer cannot read another buyer's order, keys, disputes or API data (IDOR)", async ({ page, request }) => {
  const victimOrder = sql(`select o.id from "Order" o join "User" u on u.id=o."buyerId" where u.email='user@asapawge.gg' and o.status='DELIVERED' limit 1`);
  const victimDispute = sql(`select id from "Dispute" limit 1`);
  expect(victimOrder).toBeTruthy();
  await signUp(page, "/account");
  // pages: ownership is part of the query -> 404
  const res = await page.goto(`/account/orders/${victimOrder}`);
  expect(res?.status()).toBe(404);
  expect((await page.goto(`/checkout/pay/${victimOrder}`))?.status()).toBe(404);
  if (victimDispute) {
    expect((await page.goto(`/account/disputes/${victimDispute}`))?.status()).toBe(404);
    const poll = await page.request.get(`/api/cabinet/disputes/${victimDispute}/messages`);
    expect(poll.status()).toBe(404);
  }
  // REST API with the attacker's own key
  const key = await createApiKeyViaUi(page, "idor-test", ["catalog:read", "orders:read", "orders:create"]);
  const auth = { authorization: `Bearer ${key}` };
  expect((await request.get(`/api/v1/orders/${victimOrder}`, { headers: auth })).status()).toBe(404);
  const mine = await (await request.get("/api/v1/orders", { headers: auth })).json();
  expect(mine.data.total).toBe(0);
  // scope / role enforcement: a buyer key can never reach seller or admin features
  expect((await request.get("/api/v1/admin/metrics", { headers: auth })).status()).toBe(403);
  expect((await request.post("/api/v1/admin/products/x/moderate", { headers: auth, data: { decision: "approve" } })).status()).toBe(403);
  expect((await request.get("/api/v1/seller/stats", { headers: auth })).status()).toBe(403);
  expect((await request.post("/api/v1/seller/products", { headers: auth, data: {} })).status()).toBe(403);
  // negative / absurd quantities never reach the ledger
  const bad = await request.post("/api/v1/orders", { headers: auth, data: { items: [{ productId: "x", quantity: -3 }] } });
  expect(bad.status()).toBe(422);
  const zero = await request.post("/api/v1/orders", { headers: auth, data: { items: [{ productId: "x", quantity: 0 }] } });
  expect(zero.status()).toBe(422);
});

test("buyers and sellers cannot use admin pages or seller pages they do not own", async ({ page }) => {
  await signUp(page, "/account");
  await page.goto("/admin");
  await expect(page).toHaveURL(/forbidden/);
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/forbidden/);
  await page.goto("/seller");
  await expect(page).toHaveURL(/forbidden|become-seller/);
});

test("IP rate limits cannot be dodged by spoofing the left-most X-Forwarded-For entry", async ({ request }) => {
  resetRateLimits();
  let limited = 0;
  // behind one trusted proxy the proxy appends the real peer (203.0.113.77); the client-controlled part varies on every request
  for (let i = 0; i < 28; i++) {
    const r = await request.post("/api/steam/check-login", { data: { login: `some_user_${i}` }, headers: { "x-forwarded-for": `10.9.8.${i}, 203.0.113.77` } });
    if (r.status() === 429) limited++;
  }
  expect(limited).toBeGreaterThan(0);
});

test("client analytics cannot forge server-side business events", async ({ request }) => {
  const post = (name: string, properties?: Record<string, unknown>) => request.post("/api/analytics/event", { data: { name, path: "/", properties }, headers: { "user-agent": UA } });
  const before = Number(sql(`select count(*) from "AnalyticsEvent" where name in ('sign_up','topup_balance','dispute_open','review_submit')`));
  for (const name of ["sign_up", "login", "topup_balance", "dispute_open", "review_submit"]) {
    const body = await (await post(name)).json();
    expect(body.data.tracked).toBe(false);
  }
  // a purchase for somebody else's / an unpaid / an anonymous visit is refused
  const anon = await (await post("purchase", { orderId: "whatever", value: 999999 })).json();
  expect(anon.data.tracked).toBe(false);
  expect(Number(sql(`select count(*) from "AnalyticsEvent" where name in ('sign_up','topup_balance','dispute_open','review_submit')`))).toBe(before);
  // honest browsing events are still accepted
  expect((await (await post("page_view")).json()).data.tracked).toBe(true);
});
