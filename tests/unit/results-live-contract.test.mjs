import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESULTS_LIVE_MAX_CONSECUTIVE_RELOADS } from "../../src/scripts/results-live-core";

const pollerSource = readFileSync("src/scripts/results-live.ts", "utf8");

// Source-contract coverage for the browser-coupled poller guards that the
// pure core cannot express: reload breaking, terminal statuses, validator
// regression, and connection-announcement gating.
describe("results-live poller resilience contract", () => {
  it("caps page reloads per tab before giving up to a stale Tally", () => {
    expect(RESULTS_LIVE_MAX_CONSECUTIVE_RELOADS).toBeGreaterThan(0);
    expect(pollerSource).toContain("sessionStorage");
    expect(pollerSource).toMatch(
      /reloadCount >= RESULTS_LIVE_MAX_CONSECUTIVE_RELOADS[\s\S]*?showStale\(\)/,
    );
    expect(pollerSource).toContain("resetReloadCount");
  });

  it("reloads into the truthful page state on 204 and 404 instead of retrying forever", () => {
    expect(pollerSource).toMatch(
      /response\.status === 204 \|\| response\.status === 404/,
    );
  });

  it("reloads on a validator regression instead of staying stale on healthy responses", () => {
    expect(pollerSource).toMatch(
      /!shouldAdoptResultsValidator\(validator, incomingValidator\)\) \{\s*reloadOnce\(\);/,
    );
  });

  it("announces Updates resumed. only when the Poll is still open", () => {
    expect(pollerSource).toMatch(/wasStale && payload\.status !== "closed"/);
  });
});
