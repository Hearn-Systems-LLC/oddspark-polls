#!/usr/bin/env node
/**
 * Deploy a CLOUDFLARE_ENV-built Astro Worker.
 *
 * Astro's redirected wrangler config sets no_bundle with multi-module uploads,
 * which currently 403s on this account's Workers script API for large module
 * sets. Bundle to a single module, then deploy with environment bindings from
 * wrangler.jsonc.
 *
 * Usage: node scripts/deploy.mjs staging|production
 */
import { build } from "esbuild";
import { readFile, mkdir, writeFile, cp, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envName = process.argv[2];

if (envName !== "staging" && envName !== "production") {
  console.error("Usage: node scripts/deploy.mjs staging|production");
  process.exit(1);
}

function run(cmd, args, { cwd = root, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      cwd,
      env: { ...process.env, ...env },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

/** Strip // line comments from JSONC (good enough for our wrangler.jsonc). */
function parseJsonc(text) {
  const stripped = text
    .split("\n")
    .map((line) => {
      const idx = line.indexOf("//");
      if (idx === -1) return line;
      // keep // inside strings naively by only stripping when not in quotes
      const before = line.slice(0, idx);
      if ((before.match(/"/g) ?? []).length % 2 === 0) {
        return before;
      }
      return line;
    })
    .join("\n")
    .replace(/,\s*([\]}])/g, "$1");
  return JSON.parse(stripped);
}

// 1. Build for target env
console.log(`Building for ${envName}…`);
await run("pnpm", ["exec", "astro", "build"], {
  env: { CLOUDFLARE_ENV: envName },
});

// 2. Read user wrangler for env-specific bindings
const wranglerJson = parseJsonc(
  await readFile(join(root, "wrangler.jsonc"), "utf8"),
);
const envCfg = wranglerJson.env?.[envName];
if (!envCfg?.name) {
  throw new Error(`Missing env.${envName} in wrangler.jsonc`);
}

const outDir = join(root, ".deploy", envName);
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// 3. Bundle server entry to a single module
console.log("Bundling worker…");
const entry = join(root, "dist/server/entry.mjs");
await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  outfile: join(outDir, "index.mjs"),
  platform: "neutral",
  conditions: ["workerd", "worker", "browser"],
  mainFields: ["workerd", "browser", "module", "main"],
  external: ["cloudflare:*", "node:*"],
  logLevel: "info",
});

// 4. Copy static assets
await cp(join(root, "dist/client"), join(outDir, "client"), {
  recursive: true,
});

// 5. Write deploy wrangler config
const deployConfig = {
  name: envCfg.name,
  main: "index.mjs",
  compatibility_date: wranglerJson.compatibility_date,
  compatibility_flags: wranglerJson.compatibility_flags,
  assets: {
    binding: "ASSETS",
    directory: "./client",
  },
  observability: { enabled: true },
  workers_dev: true,
  kv_namespaces: envCfg.kv_namespaces,
  d1_databases: (envCfg.d1_databases ?? []).map(
    ({ migrations_dir: _m, ...rest }) => rest,
  ),
  r2_buckets: envCfg.r2_buckets,
};

await writeFile(
  join(outDir, "wrangler.json"),
  `${JSON.stringify(deployConfig, null, 2)}\n`,
);

// 6. Deploy from the staged directory
console.log(`Deploying ${envCfg.name}…`);
await run("pnpm", ["exec", "wrangler", "deploy", "--config", "wrangler.json"], {
  cwd: outDir,
});

console.log(`✓ Deployed ${envCfg.name} (${envName})`);
