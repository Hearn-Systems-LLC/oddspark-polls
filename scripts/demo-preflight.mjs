#!/usr/bin/env node
/**
 * Privacy-safe, read-only remote D1 preflight for the configured Demo Poll.
 * The only returned field is ready/not_ready; no Poll, owner, or option ID is
 * selected into CI output.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseJsonc } from "./deploy-config.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const environment = process.argv[2];
if (environment !== "staging" && environment !== "production") {
  console.error("Usage: node scripts/demo-preflight.mjs staging|production");
  process.exit(1);
}

const config = parseJsonc(readFileSync(join(root, "wrangler.jsonc"), "utf8"));
const reference = config.env?.[environment]?.vars?.DEMO_POLL_REFERENCE;
if (typeof reference !== "string" || !/^[a-z0-9-]{1,48}$/u.test(reference)) {
  throw new Error(`Demo preflight: ${environment} has no valid public Demo reference binding`);
}

const sqlReference = reference.replaceAll("'", "''");
const sql = `
SELECT CASE WHEN COUNT(*) = 1 THEN 'ready' ELSE 'not_ready' END AS demo_preflight
FROM (
  SELECT p.id
  FROM poll AS p
  JOIN poll_reference AS pr
    ON pr.poll_id = p.id
   AND pr.reference = '${sqlReference}'
   AND pr.is_canonical = 1
  WHERE p.poll_type = 'multiple_choice'
    AND p.question = 'Best day for a long weekend?'
    AND p.result_visibility = 'live'
    AND p.discovery_state IN ('unlisted', 'listed')
    AND p.closed_at_ms IS NULL
    AND p.deadline_ms IS NULL
    AND p.multi_select_enabled = 0
    AND COALESCE(p.min_selections, 1) = 1
    AND COALESCE(p.max_selections, 1) = 1
    AND p.session_checks_enabled = 1
    AND p.ip_checks_enabled = 0
    AND p.voter_codes_enabled = 0
    AND p.captcha_enabled = 1
    AND p.vpn_blocking_enabled = 0
    AND (
      SELECT group_concat(label, '|')
      FROM (
        SELECT label
        FROM poll_option
        WHERE poll_id = p.id
        ORDER BY position
      )
    ) = 'Friday|Monday|Either works'
) AS exact_demo`;

const output = execFileSync(
  "pnpm",
  [
    "exec",
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--env",
    environment,
    "--remote",
    "--json",
    "--command",
    sql,
  ],
  {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WRANGLER_WRITE_LOGS: "false",
      WRANGLER_SEND_METRICS: "false",
    },
  },
);

let payload;
try {
  payload = JSON.parse(output);
} catch {
  throw new Error("Demo preflight: Wrangler did not return JSON");
}

if (payload?.[0]?.results?.[0]?.demo_preflight !== "ready") {
  throw new Error(`Demo preflight: ${environment} configured Poll is not ready`);
}

console.log(`Demo preflight: ${environment} configured Poll is ready`);
