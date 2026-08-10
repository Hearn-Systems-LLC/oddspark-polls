import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJsonc } from "../../scripts/deploy-config.mjs";

const read = (path) => readFileSync(path, "utf8");
const wrangler = parseJsonc(read("wrangler.jsonc"));
const workflow = read(".github/workflows/deploy.yml");
const preflight = read("scripts/demo-preflight.mjs");
const smoke = read("scripts/smoke.mjs");

describe("Demo release contract", () => {
  it("repeats the public designation in every non-inheriting Wrangler environment", () => {
    expect(wrangler.vars.DEMO_POLL_REFERENCE).toBe("demo");
    expect(wrangler.env.staging.vars.DEMO_POLL_REFERENCE).toBe("demo");
    expect(wrangler.env.production.vars.DEMO_POLL_REFERENCE).toBe("demo");
    expect(wrangler.secrets.required).not.toContain("DEMO_POLL_REFERENCE");
  });

  it("keeps the remote preflight read-only and privacy-safe", () => {
    expect(preflight).toContain("SELECT CASE WHEN COUNT(*) = 1");
    expect(preflight).toContain("'ready' ELSE 'not_ready'");
    expect(preflight).toContain('"--remote"');
    expect(preflight).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/u);
    expect(preflight).not.toContain("owner_user_id AS");
  });

  it("preflights production before migration and smokes it after deployment", () => {
    const production = workflow.slice(workflow.indexOf("deploy-production:"));
    expect(production.indexOf("Production Demo Poll preflight")).toBeLessThan(
      production.indexOf("Production migration"),
    );
    expect(production.indexOf("Production deploy")).toBeLessThan(
      production.indexOf("Production smoke"),
    );
    expect(production).toContain(
      'SMOKE_URL: "https://polls.oddspark.dev"',
    );
  });

  it("smokes the exact public Demo without mutating a Vote", () => {
    for (const copy of [
      "Best day for a long weekend?",
      "Friday",
      "Monday",
      "Either works",
      "ONE VOTE PER BROWSER",
      "HUMAN CHECK ON SUBMIT",
      "ONE VOTE PER NETWORK",
      "Current Demo Poll results",
    ]) {
      expect(smoke).toContain(copy);
    }
    expect(smoke).toContain('method: "POST"');
    expect(smoke).toContain('provider=google&return=%2Fcreator');
    expect(smoke).toContain('searchParams.get("redirect_uri")');
    expect(smoke).toContain('new URL("api/auth/callback/google", origin)');
  });
});
