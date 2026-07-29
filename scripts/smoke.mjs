#!/usr/bin/env node
/**
 * Staging smoke check: HTTP GET against placeholder page.
 * Asserts 200 and a token-derived marker in the HTML.
 *
 * Usage:
 *   SMOKE_URL=https://oddspark-polls-staging.<account>.workers.dev node scripts/smoke.mjs
 *   node scripts/smoke.mjs https://...
 */
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

const MARKER = "data-smoke-marker=\"oddspark-token-solar\"";
const TOKEN_HEX = "#C9A227";

const res = await fetch(url, {
  headers: { accept: "text/html" },
  redirect: "follow",
});

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

if (!html.includes(TOKEN_HEX) && !html.includes(TOKEN_HEX.toLowerCase())) {
  console.error(
    `smoke: missing token-derived solar hex ${TOKEN_HEX} in response body`,
  );
  process.exit(1);
}

console.log(`smoke: ok ${url} (200 + token marker)`);
