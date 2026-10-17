import { defineConfig } from "@playwright/test";

/**
 * E2E config. Expects the production app (`pnpm build && pnpm start`), the worker (API + arq), the MCP HTTP server and
 * a SEEDED database (`pnpm db:seed`) to be running — see README "Тесты".
 *
 * Browser: by default Playwright resolves its own bundled Chromium. In sandboxes where only a pre-installed build exists,
 * point PW_CHROMIUM_PATH at it, e.g.
 *   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome pnpm --filter @asap/web e2e
 */
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    launchOptions: { executablePath, args: ["--no-sandbox"] },
  },
  webServer: process.env.CI
    ? { command: "pnpm --filter @asap/web start", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 }
    : undefined,
});
