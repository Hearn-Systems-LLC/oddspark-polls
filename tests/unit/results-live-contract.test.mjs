import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESULTS_LIVE_MAX_CONSECUTIVE_RELOADS } from "../../src/scripts/results-live-core";

const pollerSource = readFileSync("src/scripts/results-live.ts", "utf8");
const tallySource = readFileSync("src/components/results-tally.astro", "utf8");
const chartSource = readFileSync(
  "src/scripts/chart-form-toggle.ts",
  "utf8",
);
const sparkSource = readFileSync("src/scripts/results-spark.ts", "utf8");

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

// Source-contract coverage for the Story 1.10 motion wiring: arming after
// first paint, the single snap mechanism, the spark restart, and the
// totals-line split that keeps a ticking count out of the polite region.
describe("results-live motion wiring contract", () => {
  it("arms transitions only with the first animated reconcile, never on load", () => {
    // The executable initial-paint guard (results.spec.mjs warm-load check)
    // reads 0s on an idle tally — arming on a post-paint timer would break
    // it, so the class lands in the same task as the first animated write.
    expect(pollerSource).toContain("armMotion");
    expect(pollerSource).toMatch(
      /armMotion\(\);\s*reconciled = reconcile\(payload, true\);/,
    );
    expect(pollerSource).not.toMatch(
      /requestAnimationFrame[\s\S]{0,160}is-motion-armed/,
    );
  });

  it("snaps recovery reconciles by stripping and re-adding the arming class", () => {
    expect(pollerSource).toMatch(
      /classList\.remove\("is-motion-armed"\)[\s\S]*?classList\.add\("is-motion-armed"\)/,
    );
    expect(pollerSource).toContain("shouldSnapResultsMotion");
    expect(pollerSource).toContain('"visibility-return"');
    expect(pollerSource).toContain('"online"');
    expect(pollerSource).toContain('"pageshow"');
    expect(pollerSource).toContain('"cadence"');
    expect(pollerSource).toMatch(
      /response\.status === 304[\s\S]*?shouldSnapResultsMotion[\s\S]*?snapMotionState\(\)/,
    );
  });

  it("batches every settle before one shared spark flush and cleans completion", () => {
    expect(pollerSource).toMatch(
      /const startedAtMs = performance\.now\(\)[\s\S]*?prepareResultsSparks\(sparkFills\)[\s\S]*?if \(sparkFills\.length > 0\) \{\s*void root\.offsetWidth;\s*startSparks\(\)/,
    );
    expect(pollerSource).toContain("shouldSparkOnCountChange");
    expect(sparkSource).toContain('addEventListener("animationend", finish)');
    expect(sparkSource).toContain("fill.classList.remove(SPARK_CLASS)");
    expect(sparkSource).toContain("activeFinishers.delete(fill)");
  });

  it("retargets count-ups and guards them with the reduced-motion query", () => {
    expect(pollerSource).toContain("retargetCountUp");
    expect(pollerSource).toMatch(
      /matchMedia\(\s*"\(prefers-reduced-motion: reduce\)",?\s*\)/,
    );
    expect(pollerSource).toContain("resolveCountUpDurationMs");
    expect(pollerSource).toMatch(
      /reducedMotionQuery\.addEventListener\("change"[\s\S]*?snapMotionState\(\)/,
    );
  });

  it("treats PIE as an explicit no-motion state and snaps before BARS reveal", () => {
    expect(chartSource).toContain("root.dataset.chartFormState = form");
    expect(chartSource).toContain("RESULTS_CHART_FORM_CHANGE_EVENT");
    expect(chartSource.indexOf("dispatchEvent")).toBeLessThan(
      chartSource.indexOf("render();", chartSource.indexOf("dispatchEvent")),
    );
    expect(pollerSource).toContain(
      'root.dataset.chartFormState === "pie"',
    );
    expect(pollerSource).toContain(
      "root.addEventListener(RESULTS_CHART_FORM_CHANGE_EVENT, snapMotionState)",
    );
  });

  it("keeps rounded-zero positive counts sparkable", () => {
    expect(pollerSource).toContain("const zero = option.count === 0");
  });

  it("keeps the accessible name an immediate final-valued write", () => {
    expect(pollerSource).toContain(
      'bar.setAttribute("aria-label", accessibleName)',
    );
  });

  it("ticks the totals line on an aria-hidden span, announcing only the final value", () => {
    expect(tallySource).toMatch(/data-live-total-visual aria-hidden="true"/);
    expect(tallySource).toMatch(/class="visually-hidden" data-live-total/);
    expect(pollerSource).toContain("[data-live-total-visual]");
    expect(pollerSource).toContain("[data-live-total]");
  });
});
