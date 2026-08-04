import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildRemoteDeployConfig } from "../../scripts/deploy-config.mjs";

/**
 * Strip JSONC // line comments and trailing commas (mirrors deploy.mjs).
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
});
