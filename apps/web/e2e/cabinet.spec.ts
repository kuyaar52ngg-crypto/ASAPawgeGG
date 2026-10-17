import { expect, test, type Page } from "@playwright/test";

// Requires the seeded demo data (pnpm db:seed) and the running stack (see playwright.config.ts).

async function login(page: Page, email: string, password: string, to: string) {
  await page.goto(`/sign-in?callbackUrl=${encodeURIComponent(to)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL(`**${to}`);
}

test("buyer sees orders and can reveal a delivered key", async ({ page }) => {
  await login(page, "user@asapawge.gg", "User123!", "/account/orders");
  await expect(page.getByRole("heading", { name: "Заказы и ключи" })).toBeVisible();
  await page.getByRole("link", { name: /AG-/ }).first().click();
  await page.getByRole("button", { name: "Показать" }).first().click();
  await expect(page.getByRole("button", { name: "Скопировать" }).first()).toBeVisible();
});

test("buyer can open the balance top-up page with sandbox payment", async ({ page }) => {
  await login(page, "user@asapawge.gg", "User123!", "/account/topup");
  await expect(page.getByText("Тестовая оплата")).toBeVisible();
  await expect(page.getByRole("button", { name: /Пополнить на/ })).toBeEnabled();
});

test("seller dashboard shows KPIs, balances and chart", async ({ page }) => {
  await login(page, "seller@asapawge.gg", "Seller123!", "/seller");
  await expect(page.getByText("Выручка сегодня")).toBeVisible();
  await expect(page.getByText("Доступно к выводу")).toBeVisible();
  await expect(page.getByRole("img", { name: "График выручки по дням" })).toBeVisible();
});

test("a plain user cannot open the seller cabinet", async ({ page }) => {
  await login(page, "user@asapawge.gg", "User123!", "/account");
  await page.goto("/seller/products");
  await expect(page).toHaveURL(/forbidden/);
});

test("seller creates a draft product", async ({ page }) => {
  await login(page, "seller@asapawge.gg", "Seller123!", "/seller/products/new");
  await page.getByLabel("Название", { exact: true }).fill("E2E draft product");
  await page.getByLabel("Полное описание").fill("Описание тестового товара для проверки формы создания карточки продавцом.");
  await page.locator("#p-price").fill("999");
  await page.locator("#p-category").click();
  await page.getByRole("option").first().click();
  await page.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(page).toHaveURL(/\/seller\/products\/.+\/edit/);
});
