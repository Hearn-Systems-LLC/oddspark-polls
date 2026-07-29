import { defineConfig, devices } from "@playwright/test";

// Dedicated port so local e2e does not collide with other Astro apps on 4321.
const port = 4391;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `ASTRO_DEV_BACKGROUND=0 pnpm dev --host 127.0.0.1 --port ${port} --ignore-lock`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
