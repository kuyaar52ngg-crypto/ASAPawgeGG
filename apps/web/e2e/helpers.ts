import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Read-only SQL helper for assertions (psql, no extra dependencies). Never use for writes that bypass the app. */
export function sql(query: string): string {
  const url = process.env.DATABASE_URL ?? "postgresql://asap:asap@localhost:5432/asapawge";
  return execFileSync("psql", [url, "-At", "-c", query], { encoding: "utf8" }).trim();
}

/** Clears Redis rate-limit counters (login 10/15min, sign-up 10/h per IP...) so repeated local runs don't lock themselves out. */
export function resetRateLimits() {
  try {
    const keys = execFileSync("redis-cli", ["--scan", "--pattern", "rl:*"], { encoding: "utf8" }).split("\n").filter(Boolean);
    for (let i = 0; i < keys.length; i += 200) execFileSync("redis-cli", ["del", ...keys.slice(i, i + 200)]);
  } catch {
    /* redis-cli unavailable: ignore */
  }
}

export const DEMO = {
  admin: { email: "admin@asapawge.gg", password: "Admin123!" },
  seller: { email: "seller@asapawge.gg", password: "Seller123!" },
  user: { email: "user@asapawge.gg", password: "User123!" },
};

export async function login(page: Page, email: string, password: string, to = "/account") {
  resetRateLimits();
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent(to)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((u) => u.pathname === to.split("?")[0], { timeout: 30_000 });
}

/** Registers a brand-new buyer through the UI (also exercises sign-up) and leaves the browser signed in. */
export async function signUp(page: Page, to = "/account"): Promise<{ email: string; password: string }> {
  resetRateLimits();
  const email = `e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}@test.local`;
  const password = "Passw0rd!1";
  await page.goto(`/sign-up?callbackUrl=${encodeURIComponent(to)}`);
  await page.fill("#name", "E2E Покупатель");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: /Создать аккаунт/ }).click();
  await page.waitForURL((u) => u.pathname === to.split("?")[0], { timeout: 30_000 });
  return { email, password };
}

/** Pays the sandbox checkout page (/checkout/sandbox/[paymentId]) via the "Оплатить" button. */
export async function paySandbox(page: Page) {
  await page.waitForURL(/checkout\/sandbox\//);
  await expect(page.getByText("ТЕСТОВЫЙ РЕЖИМ").first()).toBeVisible();
  await page.getByRole("button", { name: "Оплатить" }).click();
}

/** Signed sandbox webhook (same format the sandbox panel sends). */
export async function postSandboxWebhook(request: APIRequestContext, ev: { eventId: string; externalId: string; status: "PAID" | "FAILED" | "CANCELLED"; amount?: number }, secret = process.env.SANDBOX_WEBHOOK_SECRET ?? "dev-sandbox-webhook-secret") {
  const body = JSON.stringify(ev);
  const signature = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  return request.post("/api/payments/webhook/sandbox", { data: body, headers: { "content-type": "application/json", "x-signature": signature } });
}

/** Creates an API key through the cabinet UI and returns the plaintext key (shown once). */
export async function createApiKeyViaUi(page: Page, name: string, scopes?: string[]): Promise<string> {
  await page.goto("/account/api-keys");
  await page.locator("#key-name").fill(name);
  if (scopes) {
    for (const s of scopes) {
      const box = page.locator("label", { has: page.locator("code", { hasText: new RegExp(`^${s}$`) }) }).getByRole("checkbox");
      if ((await box.getAttribute("aria-checked")) !== "true") await box.click();
    }
  }
  await page.getByRole("button", { name: /Создать ключ/ }).click();
  const code = page.locator("code", { hasText: /^ak_live_/ }).first();
  await expect(code).toBeVisible();
  return (await code.textContent())!.trim();
}

/** Opens a product page, adds the (first/default variant of the) product to the cart and waits for the confirmation toast. */
export async function addToCart(page: Page, slug: string) {
  await page.goto(`/product/${slug}`);
  await page.getByRole("button", { name: /В корзину/ }).first().click();
  await expect(page.getByText("Добавлено в корзину").first()).toBeVisible();
}
