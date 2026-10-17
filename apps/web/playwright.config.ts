import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  use: { baseURL: process.env.APP_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  webServer: process.env.CI ? { command: "pnpm --filter @asap/web start", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 } : undefined,
});
