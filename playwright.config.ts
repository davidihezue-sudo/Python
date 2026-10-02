import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";

// Use the pre-installed Chromium when present (CI / sandbox); otherwise Playwright's own browser.
const candidates = ["/opt/pw-browsers/chromium/chrome-linux/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"];
const executablePath = process.env.CHROMIUM_PATH ?? candidates.find((p) => existsSync(p) && !p.endsWith("chromium"));
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", screenshot: "only-on-failure", launchOptions: { executablePath, args: ["--no-sandbox"] } },
  projects: [
    { name: "desktop", testIgnore: /mobile\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1360, height: 860 }, launchOptions: { executablePath, args: ["--no-sandbox"] } } },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], launchOptions: { executablePath, args: ["--no-sandbox"] } } },
  ],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { ...process.env as any, DATABASE_URL: "postgresql://autovault:autovault@localhost:5432/autovault_e2e?schema=public", AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-e2e-secret-01", APP_URL: `http://localhost:${PORT}`, STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: "./storage-e2e", REQUIRE_EMAIL_VERIFICATION: "true", VIN_DECODER: "none", OCR_PROVIDER: "text", LOG_LEVEL: "warn", NODE_ENV: "production", BCRYPT_ROUNDS: "4", ADMIN_EMAILS: "admin-e2e@example.com", CRON_SECRET: "e2e-cron-secret-e2e-cron-secret", ANTHROPIC_API_KEY: "" },
  },
});
