#!/usr/bin/env node
/**
 * Deploy a CLOUDFLARE_ENV-built Astro Worker.
 *
 * Rebundle Astro's generated graph into compact, bounded ESM chunks before
 * deploying with environment bindings from wrangler.jsonc. This keeps module
 * discovery deterministic and avoids Cloudflare API WAF false positives seen
 * with both the raw Astro graph and an equivalent monolithic bundle.
 *
 * Usage: node scripts/deploy.mjs staging|production
 */
import { build } from "esbuild";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envName = process.argv[2];

if (envName !== "staging" && envName !== "production") {
  console.error("Usage: node scripts/deploy.mjs staging|production");
  process.exit(1);
}

if (process.versions.node !== "24.18.0") {
  throw new Error(
    `Deploys require Node 24.18.0; received ${process.versions.node}. Run through nvm-exec.`,
  );
}

function run(cmd, args, { cwd = root, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      cwd,
      env: { ...process.env, ...env },
    });
    // Without an "error" listener a spawn failure (ENOENT) never fires "exit"
    // and the deploy hangs forever.
    child.on("error", (err) => {
      reject(new Error(`${cmd} failed to start: ${err.message}`));
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`));
    });
  });
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function removeGeneratedDevVars(directory) {
  if (!(await pathExists(directory))) return;
  for (const name of await readdir(directory)) {
    if (name === ".dev.vars" || name.startsWith(".dev.vars.")) {
      await rm(join(directory, name), { force: true });
    }
  }
}

async function listFiles(directory) {
  if (!(await pathExists(directory))) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listFiles(path)));
    else files.push(path);
  }
  return files;
}

async function assertNoLocalSecretValues(directory) {
  const localVarsPath = join(root, ".dev.vars");
  if (!(await pathExists(localVarsPath))) return;

  const localBindings = Object.fromEntries(
    (await readFile(localVarsPath, "utf8"))
      .split(/\r?\n/u)
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separator = line.indexOf("=");
        return separator < 0
          ? [line, ""]
          : [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  const files = await listFiles(directory);
  const leakedNames = [];

  for (const [name, value] of Object.entries(localBindings)) {
    if (!value) continue;
    for (const file of files) {
      if ((await readFile(file)).includes(Buffer.from(value))) {
        leakedNames.push(name);
        break;
      }
    }
  }

  if (leakedNames.length > 0) {
    throw new Error(
      `Local secret material reached build artifacts: ${leakedNames.join(", ")}`,
    );
  }
}

/**
 * Strip JSONC // line comments and trailing commas with a real scanner —
 * regexes corrupt string contents containing "//" or ", }".
 */
function parseJsonc(text) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  // Remove trailing commas (`,` followed only by whitespace before } or ]),
  // again string-aware.
  const chars = [...out];
  inString = false;
  escaped = false;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < chars.length && /\s/.test(chars[j])) j++;
      if (chars[j] === "}" || chars[j] === "]") chars[i] = " ";
    }
  }
  return JSON.parse(chars.join(""));
}

// 1. Build for target env. An empty environment-specific dev-vars file keeps
// Wrangler/Astro from falling back to the local `.dev.vars` credentials.
const remoteDevVarsPath = join(root, `.dev.vars.${envName}`);
if (await pathExists(remoteDevVarsPath)) {
  throw new Error(
    `Refusing remote build while ${remoteDevVarsPath} exists. Remote secrets belong in Cloudflare only.`,
  );
}

await writeFile(remoteDevVarsPath, "", { flag: "wx", mode: 0o600 });
try {
  console.log(`Building for ${envName}…`);
  await run("pnpm", ["exec", "astro", "build"], {
    env: { CLOUDFLARE_ENV: envName },
  });
} finally {
  await rm(remoteDevVarsPath, { force: true });
}

await removeGeneratedDevVars(join(root, "dist", "server"));
await assertNoLocalSecretValues(join(root, "dist"));

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

// 3. Bundle server entry into a compact ESM graph. Keeping generated
// dependencies in bounded modules avoids Cloudflare API WAF false positives
// on the equivalent monolithic upload (workers-sdk#14922).
console.log("Bundling worker…");
const entry = join(root, "dist/server/entry.mjs");
const workerDir = join(outDir, "worker");
await build({
  entryPoints: [entry],
  bundle: true,
  // Keep the multipart payload compact to reduce transfer and startup parsing.
  minify: true,
  splitting: true,
  format: "esm",
  outdir: workerDir,
  entryNames: "index",
  chunkNames: "chunks/[name]-[hash]",
  outExtension: { ".js": ".mjs" },
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
  main: "worker/index.mjs",
  no_bundle: true,
  rules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
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
await assertNoLocalSecretValues(outDir);

// 6. Deploy from the staged directory
console.log(`Deploying ${envCfg.name}…`);
await run("pnpm", ["exec", "wrangler", "deploy", "--config", "wrangler.json"], {
  cwd: outDir,
});

console.log(`✓ Deployed ${envCfg.name} (${envName})`);
