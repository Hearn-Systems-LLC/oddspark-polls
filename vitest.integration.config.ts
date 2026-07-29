import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

/**
 * Integration project: Vitest 4 + @cloudflare/vitest-pool-workers 0.19
 * via the cloudflareTest() plugin (replaces defineWorkersConfig).
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      main: "./tests/integration/worker-entry.ts",
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        compatibilityFlags: ["nodejs_compat"],
      },
    }),
  ],
  test: {
    name: "integration",
    include: ["tests/integration/**/*.{test,spec}.ts"],
  },
});
