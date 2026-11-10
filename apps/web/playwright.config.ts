import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against the real API + built PWA, with the offline demo source
 * (HANYO_DEMO_SOURCE=1): no network, generated pages. Run `npm run build` first.
 */
const PORT = 3199;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["iPhone 15 Pro"],
    // The pre-installed browser in some environments is Chromium only; WebKit isn't needed here.
    browserName: "chromium",
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
  },
  webServer: {
    command: `rm -rf .e2e-data && DATA_DIR=.e2e-data HANYO_DEMO_SOURCE=1 API_PORT=${PORT} UPDATE_INTERVAL_MIN=0 WEB_DIR=build npx tsx ../api/src/index.ts`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
