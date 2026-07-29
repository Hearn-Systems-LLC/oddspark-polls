#!/usr/bin/env node
/**
 * Staging smoke check: HTTP GET against placeholder page.
 * Asserts 200, the smoke marker, and that the served HTML carries the
 * solar token hex read from the canonical token source (tokens.css).
 *
 * Usage:
 *   SMOKE_URL=https://oddspark-polls-staging.<account>.workers.dev node scripts/smoke.mjs
 *   node scripts/smoke.mjs https://...
 */
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const url =
  process.argv[2] ||
  process.env.SMOKE_URL ||
  process.env.STAGING_URL ||
  "";

if (!url) {
  console.error(
    "smoke: provide SMOKE_URL / STAGING_URL env or a URL argument",
  );
  process.exit(1);
}

// The expected hex comes from the token system itself, not a hardcoded copy —
// deleting or changing --color-solar-dark must change what this asserts.
const tokensCss = await readFile(
  join(root, "src", "styles", "tokens.css"),
  "utf8",
);
const tokenHex = tokensCss.match(
  /--color-solar-dark:\s*(#[0-9a-fA-F]{3,8})\s*;/,
)?.[1];
if (!tokenHex) {
  console.error("smoke: --color-solar-dark not found in src/styles/tokens.css");
  process.exit(1);
}

const MARKER = "data-smoke-marker=\"oddspark-token-solar\"";

let res;
try {
  res = await fetch(url, {
    headers: { accept: "text/html" },
    redirect: "follow",
    // Bound the attempt so a hung connection can't defeat the retry loop.
    signal: AbortSignal.timeout(15000),
  });
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  console.error(`smoke: request failed for ${url}: ${reason}`);
  process.exit(1);
}

if (res.status !== 200) {
  console.error(`smoke: expected 200, got ${res.status} for ${url}`);
  process.exit(1);
}

const html = await res.text();

if (!html.includes(MARKER)) {
  console.error(
    `smoke: missing token marker ${MARKER} in response body from ${url}`,
  );
  process.exit(1);
}

if (!html.includes(tokenHex)) {
  console.error(
    `smoke: served HTML does not carry the solar token hex ${tokenHex} from tokens.css`,
  );
  process.exit(1);
}

console.log(`smoke: ok ${url} (200 + token marker + token hex ${tokenHex})`);
