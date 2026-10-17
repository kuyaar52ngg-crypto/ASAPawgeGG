import { expect, test } from "@playwright/test";

test("home renders catalog data from DB", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Хиты продаж" })).toBeVisible();
});

test("admin area requires login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/sign-in/);
});
