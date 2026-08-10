#!/usr/bin/env node
/**
 * Staging smoke check: HTTP GET against the product landing page.
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

const origin = new URL(url).origin;
const baseUrl = url.endsWith("/") ? url : `${url}/`;

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

const fail = (message) => {
  console.error(`smoke: ${message}`);
  process.exit(1);
};

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

const demoQuestion = "Best day for a long weekend?";
const optionLabels = ["Friday", "Monday", "Either works"];
const optionPositions = optionLabels.map((label) => html.indexOf(`>${label}<`));
if (!html.includes(demoQuestion)) fail("missing the configured Demo question");
if (optionPositions.some((position) => position < 0)) {
  fail("missing one or more configured Demo option labels");
}
if (!(optionPositions[0] < optionPositions[1] && optionPositions[1] < optionPositions[2])) {
  fail("configured Demo option labels are not in the required order");
}
if (!/<form\b[^>]*\baction="\/"[^>]*\bdata-vote-form\b|<form\b[^>]*\bdata-vote-form\b[^>]*\baction="\/"/u.test(html)) {
  fail("missing the real root Demo vote form");
}
const canonicalDemoUrl = new URL("demo", baseUrl).toString();
if (!html.includes(canonicalDemoUrl)) fail("missing the canonical Demo Share URL");
if (!html.includes("ONE VOTE PER BROWSER")) fail("missing the Session trust claim");
if (!html.includes("HUMAN CHECK ON SUBMIT")) fail("missing the CAPTCHA trust claim");
if (html.includes("ONE VOTE PER NETWORK")) fail("unexpected IP trust claim");
if (!html.includes('aria-label="Current Demo Poll results"')) {
  fail("missing the configured Demo Results group");
}

console.log(
  `smoke: ok ${url} (200 + token marker + exact configured Demo + token hex ${tokenHex})`,
);

// Auth liveness: createAuth throws at request time when any of the six auth
// bindings is missing, so a deploy with a forgotten secret would pass the
// page check above while every auth call 500s. /api/auth/ok is Better Auth's
// unauthenticated health route — it exercises auth config construction (but
// not D1; a broken DB binding with valid secrets still passes). Join
// relatively so a SMOKE_URL with a path prefix is preserved.
const authUrl = new URL("api/auth/ok", baseUrl).toString();
let authRes;
try {
  authRes = await fetch(authUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  console.error(`smoke: auth liveness request failed for ${authUrl}: ${reason}`);
  process.exit(1);
}

if (authRes.status !== 200) {
  console.error(
    `smoke: auth liveness expected 200, got ${authRes.status} for ${authUrl} — check auth bindings`,
  );
  process.exit(1);
}

console.log(`smoke: ok ${authUrl} (auth liveness 200)`);

// Auth origin correctness: config construction can succeed while Better
// Auth still carries a stale base URL. Initiating Google OAuth does not
// authenticate or write product data; it gives us the provider redirect so
// the callback URI can be compared with the exact public origin being smoked.
const signInUrl = new URL("api/sign-in", baseUrl).toString();
let signInRes;
try {
  signInRes = await fetch(signInUrl, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "provider=google&return=%2Fcreator",
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  console.error(`smoke: auth origin request failed for ${signInUrl}: ${reason}`);
  process.exit(1);
}

if (signInRes.status !== 303) {
  console.error(
    `smoke: auth origin expected 303, got ${signInRes.status} for ${signInUrl}`,
  );
  process.exit(1);
}

const providerLocation = signInRes.headers.get("location");
let redirectUri = null;
try {
  redirectUri = providerLocation
    ? new URL(providerLocation).searchParams.get("redirect_uri")
    : null;
} catch {
  // The stable mismatch below reports a missing/malformed provider Location.
}
const expectedRedirectUri = new URL("api/auth/callback/google", origin).toString();
if (redirectUri !== expectedRedirectUri) {
  console.error(
    `smoke: auth callback origin mismatch; expected ${expectedRedirectUri}, got ${redirectUri ?? "missing"}`,
  );
  process.exit(1);
}

console.log(`smoke: ok ${signInUrl} (OAuth callback uses ${origin})`);

// Binding liveness: neither probe above touches VOTE_DIGEST_SECRET, DB, or
// SESSION — a deploy with a forgotten digest secret (the same forgotten-
// secret failure class the auth probe names) would pass both while every
// vote 500s. /api/health returns 200 or lists the missing binding names.
const healthUrl = new URL("api/health", baseUrl).toString();
let healthRes;
try {
  healthRes = await fetch(healthUrl, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
} catch (err) {
  const reason = err instanceof Error ? err.message : String(err);
  console.error(`smoke: binding liveness request failed for ${healthUrl}: ${reason}`);
  process.exit(1);
}

if (healthRes.status !== 200) {
  const detail = await healthRes.text().catch(() => "");
  console.error(
    `smoke: binding liveness expected 200, got ${healthRes.status} for ${healthUrl} — check bindings (${detail})`,
  );
  process.exit(1);
}

console.log(`smoke: ok ${healthUrl} (binding liveness 200)`);
