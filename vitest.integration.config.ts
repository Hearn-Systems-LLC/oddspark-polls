import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { getViteConfig } from "astro/config";

const migrations = await readD1Migrations("./db/migrations");

/**
 * Integration project: Vitest 4 + @cloudflare/vitest-pool-workers 0.19
 * via the cloudflareTest() plugin (replaces defineWorkersConfig).
 */
export default getViteConfig({
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
          // Official always-pass Turnstile dummy secret (local/CI only).
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
          VOTE_DIGEST_SECRET: "integration-vote-digest-secret",
        },
      },
    }),
  ],
  resolve: {
    alias: [
      // Astro virtual module — lets tests import the real src/middleware.ts
      {
        find: "astro:middleware",
        replacement: new URL(
          "./tests/integration/astro-middleware-shim.ts",
          import.meta.url,
        ).pathname,
      },
      // workerd prohibits runtime WebAssembly compilation; Astro's test
      // container only needs the lexer's equivalent JavaScript build.
      { find: /^es-module-lexer$/, replacement: "es-module-lexer/js" },
    ],
  },
  test: {
    name: "integration",
    include: ["tests/integration/**/*.{test,spec}.ts"],
  },
}, {
  // Compile .astro imports without loading the production Cloudflare adapter;
  // the workerd pool plugin above owns this test environment.
  configFile: false,
  output: "server",
});
