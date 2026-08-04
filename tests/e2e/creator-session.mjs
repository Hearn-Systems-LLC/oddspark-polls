import { execFileSync } from "node:child_process";
import { randomUUID, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Authenticated-create e2e support: seeds a Better Auth session directly into
// local D1 and signs the session cookie exactly the way better-call does —
// this mirrors better-call@1.3.7's `signCookieValue` (HMAC-SHA256 over the
// token → base64 → `value.signature` → encodeURIComponent). A better-auth
// bump that changes the signature format means this harness has drifted, not
// that the app regressed. Same approach as the story's scripted smoke,
// committed as a real test.
// (.mjs like no-raw-html.test.mjs: node APIs without node types.)

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

function betterAuthSecret() {
  const vars = readFileSync(`${repoRoot}.dev.vars`, "utf8");
  const match = /^BETTER_AUTH_SECRET=(.+)$/m.exec(vars);
  return match?.[1]?.trim() ?? "";
}

// The authed suite skips (rather than fails) on a machine without a
// provisioned .dev.vars.
export function hasBetterAuthSecret() {
  try {
    return betterAuthSecret().length > 0;
  } catch {
    return false;
  }
}

// All IDs interpolated into SQL are randomUUID()s this harness minted —
// asserted at the boundary anyway, so a future refactor can't smuggle raw
// request data into a query string.
const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value) {
  if (!UUID_SHAPE.test(value)) {
    throw new Error(`Refusing to interpolate a non-UUID into SQL: ${value}`);
  }
}

function sleepMs(ms) {
  // Synchronous backoff (Atomics.wait is permitted on Node's main thread).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function wrangler(args) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return execFileSync("pnpm", ["exec", "wrangler", ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      const stderr = error?.stderr?.toString().trim() ?? "";
      // The dev server shares the same local SQLite files — brief lock
      // contention is a flake, not a failure. Back off and retry.
      if (attempt < 2 && /locked|busy/i.test(stderr)) {
        sleepMs(250 * (attempt + 1));
        continue;
      }
      throw new Error(
        `wrangler ${args.join(" ")} failed: ${stderr || error.message}`,
      );
    }
  }
  throw new Error("unreachable");
}

function d1Execute(sql) {
  wrangler(["d1", "execute", "DB", "--local", "--command", sql]);
}

// Results-route fixtures seed polls/votes directly (the route under test is
// read-only), so the execute half of the D1 pair is exported alongside the
// query half. All interpolated IDs must pass assertUuid first.
export { d1Execute };

export function d1Query(sql) {
  const out = wrangler([
    "d1",
    "execute",
    "DB",
    "--local",
    "--json",
    "--command",
    sql,
  ]);
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(
      `wrangler d1 execute did not return JSON. stdout:\n${out.slice(0, 500)}`,
    );
  }
  return parsed[0]?.results ?? [];
}

const USER_ROLES = new Set(["creator", "administrator"]);

export async function seedCreatorSession(role = "creator") {
  if (!USER_ROLES.has(role)) {
    throw new Error(`Unknown E2E user role: ${role}`);
  }
  const secret = betterAuthSecret();
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET is missing from .dev.vars");
  }
  const userId = randomUUID();
  const sessionId = randomUUID();
  const token = randomUUID().replaceAll("-", "").repeat(2);
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const name = role === "administrator" ? "E2E Administrator" : "E2E Creator";
  d1Execute(
    `INSERT INTO user (id, name, email, email_verified, role, created_at, updated_at) VALUES ('${userId}', '${name}', '${userId}@example.test', 1, '${role}', '${now}', '${now}');` +
      `INSERT INTO session (id, expires_at, token, user_id, created_at, updated_at) VALUES ('${sessionId}', '${expires}', '${token}', '${userId}', '${now}', '${now}');`,
  );

  const key = await webcrypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await webcrypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  let binary = "";
  for (const byte of new Uint8Array(signature)) {
    binary += String.fromCharCode(byte);
  }
  return {
    userId,
    cookieValue: encodeURIComponent(`${token}.${btoa(binary)}`),
  };
}

export function cleanupCreator(userId) {
  assertUuid(userId);
  // Clean vote and Poll facts explicitly so test failures remain inspectable
  // and retries do not inherit accepted submissions.
  d1Execute(
    `DELETE FROM moderation_action WHERE actor_user_id = '${userId}' OR poll_id IN (SELECT id FROM poll WHERE owner_user_id = '${userId}');` +
      `DELETE FROM voter_claim WHERE poll_id IN (SELECT id FROM poll WHERE owner_user_id = '${userId}');` +
      `DELETE FROM vote_selection WHERE vote_id IN (SELECT id FROM vote WHERE poll_id IN (SELECT id FROM poll WHERE owner_user_id = '${userId}'));` +
      `DELETE FROM vote WHERE poll_id IN (SELECT id FROM poll WHERE owner_user_id = '${userId}');` +
      `DELETE FROM poll_option WHERE poll_id IN (SELECT id FROM poll WHERE owner_user_id = '${userId}');` +
      `DELETE FROM poll_reference WHERE poll_id IN (SELECT id FROM poll WHERE owner_user_id = '${userId}');` +
      `DELETE FROM poll WHERE owner_user_id = '${userId}';` +
      `DELETE FROM session WHERE user_id = '${userId}';` +
      `DELETE FROM user WHERE id = '${userId}';`,
  );
}

export function closePoll(pollId, closedAtMs) {
  assertUuid(pollId);
  if (!Number.isInteger(closedAtMs) || closedAtMs < 0) {
    throw new Error("closedAtMs must be a non-negative integer");
  }
  d1Execute(
    `UPDATE poll SET closed_at_ms = ${closedAtMs} WHERE id = '${pollId}';`,
  );
}

// Task 9 pins closure-by-deadline: fixtures that need a closed Poll seed a
// past deadline, not only closed_at_ms.
export function setPollDeadline(pollId, deadlineMs) {
  assertUuid(pollId);
  if (!Number.isInteger(deadlineMs) || deadlineMs < 0) {
    throw new Error("deadlineMs must be a non-negative integer");
  }
  d1Execute(
    `UPDATE poll SET deadline_ms = ${deadlineMs} WHERE id = '${pollId}';`,
  );
}

const RESULT_VISIBILITIES = new Set(["live", "after_close", "creator_only"]);

export function setResultVisibility(pollId, visibility) {
  assertUuid(pollId);
  if (!RESULT_VISIBILITIES.has(visibility)) {
    throw new Error(`Unknown result_visibility: ${visibility}`);
  }
  d1Execute(
    `UPDATE poll SET result_visibility = '${visibility}' WHERE id = '${pollId}';`,
  );
}

// Removes a Poll and its dependent rows (the CLI runs without FK pragmas, so
// children go first) — exercises the deleted-between-GET-and-POST path.
export function deletePoll(pollId) {
  assertUuid(pollId);
  d1Execute(
    `DELETE FROM voter_claim WHERE poll_id = '${pollId}';` +
      `DELETE FROM vote_selection WHERE vote_id IN (SELECT id FROM vote WHERE poll_id = '${pollId}');` +
      `DELETE FROM vote WHERE poll_id = '${pollId}';` +
      `DELETE FROM poll_option WHERE poll_id = '${pollId}';` +
      `DELETE FROM poll_reference WHERE poll_id = '${pollId}';` +
      `DELETE FROM poll WHERE id = '${pollId}';`,
  );
}

// The authed suite targets the Playwright-configured server only — the
// config's baseURL is the single source of the port; never hardcode one.
export function requireBaseUrl(baseURL) {
  if (!baseURL) {
    throw new Error(
      "Playwright baseURL is unset — playwright.config.ts owns the e2e origin",
    );
  }
  return baseURL;
}

// Backdates a poll's created_at_ms — used to exercise the just-created
// freshness window from the outside.
export function agePoll(pollId, createdAtMs) {
  assertUuid(pollId);
  if (!Number.isInteger(createdAtMs) || createdAtMs < 0) {
    throw new Error("createdAtMs must be a non-negative integer");
  }
  d1Execute(`UPDATE poll SET created_at_ms = ${createdAtMs} WHERE id = '${pollId}';`);
}
