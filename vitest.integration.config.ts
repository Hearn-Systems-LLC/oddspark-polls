import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { getViteConfig } from "astro/config";
import { readFileSync } from "node:fs";

const migrations = await readD1Migrations("./db/migrations");
const tokensCssUrl = new URL("./src/styles/tokens.css", import.meta.url);
const rawTokensCssId = "\0oddspark:tokens-css-raw";

// Astro's workerd test transform otherwise reduces CSS imports to side effects,
// including Vite's `?raw` form. Preserve the production raw-string contract so
// AstroContainer exercises the same smoke-marker guard as the built Worker.
const rawTokensCssForWorkers = {
  name: "oddspark-raw-tokens-css-for-workers-tests",
  enforce: "pre" as const,
  resolveId(source: string): string | undefined {
    if (source.endsWith("/styles/tokens.css?raw")) {
      return rawTokensCssId;
    }
    return undefined;
  },
  load(id: string): string | undefined {
    if (id === rawTokensCssId) {
      return `export default ${JSON.stringify(readFileSync(tokensCssUrl, "utf8"))};`;
    }
    return undefined;
  },
};

/**
 * Integration project: Vitest 4 + @cloudflare/vitest-pool-workers 0.19
 * via the cloudflareTest() plugin (replaces defineWorkersConfig).
 */
export default getViteConfig({
  plugins: [
    rawTokensCssForWorkers,
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
