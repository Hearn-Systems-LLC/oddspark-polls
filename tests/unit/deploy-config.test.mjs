import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildRemoteDeployConfig,
  parseJsonc,
} from "../../scripts/deploy-config.mjs";

const wranglerJson = parseJsonc(readFileSync("wrangler.jsonc", "utf8"));
const ALWAYS_PASS = "1x00000000000000000000AA";
const DUMMY_SECRET = "1x0000000000000000000000000000000AA";
const REQUIRED_SECRETS = [
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "TURNSTILE_SECRET_KEY",
  "VOTE_DIGEST_SECRET",
];

describe("buildRemoteDeployConfig", () => {
  it("copies staging vars, secrets, and ratelimits without local test bindings", () => {
    const config = buildRemoteDeployConfig(wranglerJson, "staging");
    expect(config.name).toBe("oddspark-polls-staging");
    expect(config.workers_dev).toBe(true);
    expect(config.routes).toBeUndefined();
    expect(config.vars.TURNSTILE_SITE_KEY).toBe(
      wranglerJson.env.staging.vars.TURNSTILE_SITE_KEY,
    );
    expect(config.vars.TURNSTILE_SITE_KEY).not.toBe(ALWAYS_PASS);
    expect(config.vars.DEMO_POLL_REFERENCE).toBe("demo");
    expect(config.secrets.required).toEqual(REQUIRED_SECRETS);
    expect(config.ratelimits).toEqual(wranglerJson.env.staging.ratelimits);
    expect(config.kv_namespaces).toEqual(wranglerJson.env.staging.kv_namespaces);
    expect(config.r2_buckets).toEqual(wranglerJson.env.staging.r2_buckets);
    expect(JSON.stringify(config)).not.toContain(ALWAYS_PASS);
    expect(JSON.stringify(config)).not.toContain(DUMMY_SECRET);
  });

  it("copies production vars, secrets, and ratelimits without local test bindings", () => {
    const config = buildRemoteDeployConfig(wranglerJson, "production");
    expect(config.name).toBe("oddspark-polls");
    expect(config.workers_dev).toBe(false);
    expect(config.routes).toEqual([
      { pattern: "polls.oddspark.dev", custom_domain: true },
    ]);
    expect(config.vars.TURNSTILE_SITE_KEY).toBe(
      wranglerJson.env.production.vars.TURNSTILE_SITE_KEY,
    );
    expect(config.vars.TURNSTILE_SITE_KEY).not.toBe(
      wranglerJson.env.staging.vars.TURNSTILE_SITE_KEY,
    );
    expect(config.vars.DEMO_POLL_REFERENCE).toBe("demo");
    expect(config.secrets.required).toEqual(REQUIRED_SECRETS);
    expect(config.ratelimits).toEqual(wranglerJson.env.production.ratelimits);
    expect(JSON.stringify(config)).not.toContain(ALWAYS_PASS);
    expect(JSON.stringify(config)).not.toContain(DUMMY_SECRET);
  });

  it("rejects unsupported environments", () => {
    expect(() => buildRemoteDeployConfig(wranglerJson, "local")).toThrow(
      /Unsupported deploy environment/,
    );
  });

  it("carries the cleanup cron trigger into both deploy configs", () => {
    for (const envName of ["staging", "production"]) {
      const config = buildRemoteDeployConfig(wranglerJson, envName);
      expect(config.triggers).toEqual(wranglerJson.env[envName].triggers);
      expect(config.triggers.crons).toContain("*/15 * * * *");
    }
  });

  it("falls back to the root triggers when an environment omits them", () => {
    const stripped = structuredClone(wranglerJson);
    delete stripped.env.staging.triggers;

    const config = buildRemoteDeployConfig(stripped, "staging");

    expect(config.triggers).toEqual(wranglerJson.triggers);
    expect(config.triggers.crons).toContain("*/15 * * * *");
  });
});
