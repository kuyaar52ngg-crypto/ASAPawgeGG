/**
 * Takes desktop (1440) + mobile (390) screenshots of the key pages into docs/screenshots/.
 *   PW_CHROMIUM_PATH=... node apps/web/e2e/screenshots.mjs        (stack must be running, DB seeded)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BASE = process.env.APP_URL ?? "http://localhost:3000";
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/screenshots");
mkdirSync(OUT, { recursive: true });
const sql = (q) => execFileSync("psql", [process.env.DATABASE_URL ?? "postgresql://asap:asap@localhost:5432/asapawge", "-At", "-c", q], { encoding: "utf8" }).trim();
try { execFileSync("redis-cli", ["--scan", "--pattern", "rl:*"]).toString().split("\n").filter(Boolean).forEach((k) => execFileSync("redis-cli", ["del", k])); } catch {}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined, args: ["--no-sandbox"] });
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

async function settle(page, full) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(800);
  if (full) {
    // scroll with real wheel events so ScrollTrigger reveals / counters run
    const h = await page.evaluate(() => document.body.scrollHeight);
    await page.mouse.move(200, 300);
    for (let y = 0; y < h; y += 400) { await page.mouse.wheel(0, 400); await page.waitForTimeout(160); }
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(700);
  }
}

async function login(page, email, password) {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Пароль").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 });
}

const orderId = sql(`select o.id from "Order" o join "User" u on u.id=o."buyerId" where u.email='user@asapawge.gg' and o.status='DELIVERED' order by o."createdAt" desc limit 1`);

const shots = [
  { name: "home", role: null, url: "/", full: true },
  { name: "catalog", role: null, url: "/catalog", full: true },
  { name: "product", role: null, url: "/product/elden-ring", full: true },
  { name: "steam", role: null, url: "/steam", full: true },
  { name: "cart", role: null, url: "/cart", full: false, prepare: async (page) => { await page.goto(`${BASE}/product/stardew-valley`); await page.getByRole("button", { name: /В корзину/ }).first().click(); await page.getByText("Добавлено в корзину").first().waitFor(); } },
  { name: "account-order", role: ["user@asapawge.gg", "User123!"], url: `/account/orders/${orderId}`, full: true },
  { name: "seller-dashboard", role: ["seller@asapawge.gg", "Seller123!"], url: "/seller", full: true },
  { name: "admin-dashboard", role: ["admin@asapawge.gg", "Admin123!"], url: "/admin", full: true },
];

for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: vpName === "mobile", hasTouch: vpName === "mobile" });
    const page = await ctx.newPage();
    if (s.role) await login(page, ...s.role);
    if (s.prepare) await s.prepare(page);
    await page.goto(`${BASE}${s.url}`, { waitUntil: "domcontentloaded" });
    await settle(page, s.full);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    const file = path.join(OUT, `${s.name}-${vpName}.png`);
    await page.screenshot({ path: file, fullPage: s.full });
    console.log(`${s.name}-${vpName}.png  overflowX=${overflow}`);
    await ctx.close();
  }
}
await browser.close();
