import { expect, test } from "@playwright/test";
import { addToCart, resetRateLimits } from "./helpers";

/**
 * Commerce flow (zone B): guest cart -> sign-up (cart merge) -> checkout with promo -> sandbox payment -> key delivered.
 * Requires a seeded DB and the sandbox provider (no Platega / RollyPay keys). Run: pnpm --filter @asap/web e2e
 */
test("guest cart survives sign-up; sandbox payment delivers the key", async ({ page }) => {
  resetRateLimits();
  const email = `e2e-${Date.now()}@test.local`;

  await addToCart(page, "elden-ring");
  await page.goto("/cart");
  await expect(page.getByText("Elden Ring").first()).toBeVisible();

  await page.getByRole("link", { name: /Оформить заказ/ }).click();
  await expect(page).toHaveURL(/sign-in/);
  await page.goto("/sign-up?callbackUrl=%2Fcheckout");
  await page.fill("#name", "E2E Покупатель");
  await page.fill("#email", email);
  await page.fill("#password", "Passw0rd!1");
  await page.getByRole("button", { name: /Создать аккаунт/ }).click();
  await page.waitForURL((u) => u.pathname === "/checkout");
  await expect(page.getByText("Elden Ring").first()).toBeVisible(); // merged guest cart

  await page.fill('input[name="promoCode"]', "WELCOME10");
  await page.getByRole("button", { name: "Применить" }).click();
  await expect(page.getByText(/WELCOME10: скидка/)).toBeVisible();
  await expect(page.locator('input[name="paymentMethod"][value="BALANCE"]')).toBeDisabled(); // new account has 0 ₽

  await page.locator('label:has-text("Тестовая оплата")').click();
  await page.getByRole("button", { name: /Перейти к оплате/ }).click();
  await page.waitForURL(/checkout\/sandbox\//);
  await expect(page.getByText("ТЕСТОВЫЙ РЕЖИМ").first()).toBeVisible();

  // declined payment keeps the order payable
  await page.getByRole("button", { name: "Отклонить" }).click();
  await page.waitForURL(/checkout\/fail/);
  await page.getByRole("link", { name: /другой способ оплаты/ }).click();
  await page.waitForURL(/checkout\/pay\//);
  await page.locator('label:has-text("Тестовая оплата")').click();
  await page.getByRole("button", { name: /^Оплатить/ }).click();
  await page.waitForURL(/checkout\/sandbox\//);
  await page.getByRole("button", { name: "Оплатить" }).click();

  await page.waitForURL(/checkout\/success/);
  await expect(page.getByRole("heading", { name: "Заказ выдан!" })).toBeVisible({ timeout: 30_000 });
  // keys are not part of the page: they are fetched (and ownership re-checked) when the buyer presses «Показать»
  expect(await page.content()).not.toMatch(/[A-Z0-9]{4,}-[A-Z0-9]{4,}-[A-Z0-9]{4,}/);
  await page.getByRole("button", { name: "Показать" }).first().click();
  await expect(page.locator("code").first()).toHaveText(/[A-Z0-9]{4,}-[A-Z0-9]{4,}/);
});

test("checkout requires login", async ({ page }) => {
  await page.goto("/checkout");
  await expect(page).toHaveURL(/sign-in\?callbackUrl=%2Fcheckout/);
});
