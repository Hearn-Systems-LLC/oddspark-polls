import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

const migrations = await readD1Migrations("./db/migrations");

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
        bindings: {
          TEST_MIGRATIONS: migrations,
          BETTER_AUTH_SECRET:
            "integration-secret-that-is-at-least-32-characters",
          BETTER_AUTH_URL: "https://polls.example.test",
          GOOGLE_CLIENT_ID: "integration-google-client",
          GOOGLE_CLIENT_SECRET: "integration-google-secret",
          GITHUB_CLIENT_ID: "integration-github-client",
          GITHUB_CLIENT_SECRET: "integration-github-secret",
        },
      },
    }),
  ],
  resolve: {
    alias: {
      // Astro virtual module — lets tests import the real src/middleware.ts
      "astro:middleware": new URL(
        "./tests/integration/astro-middleware-shim.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    name: "integration",
    include: ["tests/integration/**/*.{test,spec}.ts"],
  },
});
