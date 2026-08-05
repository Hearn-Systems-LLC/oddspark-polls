import { defineConfig, devices } from "@playwright/test";

// Dedicated port so local e2e does not collide with other Astro apps on 4321.
const port = 4391;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  // Runner cleanup must never delete committed browser-proof directories.
  outputDir: ".playwright-output",
  fullyParallel: true,
  // Every E2E worker talks to the same Wrangler local-persistence directory.
  // A per-file serial describe does not prevent other files from writing the
  // shared D1 concurrently, so keep the documented `pnpm test:e2e` command
  // deterministic instead of relying on retries for SQLite contention.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
    command: `ASTRO_DEV_BACKGROUND=0 pnpm dev --host 127.0.0.1 --port ${port} --ignore-lock`,
    // Root deliberately returns 503 until the configured Demo is seeded;
    // liveness belongs to the presence-only endpoint, and every Demo suite
    // provisions its exact fixture only after this readiness boundary passes.
    url: `${baseURL}/api/health`,
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
