import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatVoteTotal,
  liveIndicatorState,
} from "../../src/components/live-indicator";

const indicatorSource = readFileSync(
  "src/components/live-indicator.astro",
  "utf8",
);
const tallySource = readFileSync("src/components/results-tally.astro", "utf8");

describe("liveIndicatorState", () => {
  it("renders an open Poll as a decorative dot plus LIVE", () => {
    expect(liveIndicatorState("open")).toEqual({
      label: "LIVE",
      showDot: true,
    });
  });

  it("renders a closed Poll as CLOSED without a dot", () => {
    expect(liveIndicatorState("closed")).toEqual({
      label: "CLOSED",
      showDot: false,
    });
  });
});

describe("formatVoteTotal", () => {
  it.each([
    [0, "0 VOTES"],
    [1, "1 VOTE"],
    [2, "2 VOTES"],
  ])("formats %s as %s", (count, expected) => {
    expect(formatVoteTotal(count)).toBe(expected);
  });
});

describe("live indicator component contract", () => {
  it("keeps the gold dot decorative, non-interactive, and token-bound", () => {
    expect(indicatorSource).toContain('aria-hidden="true"');
    expect(indicatorSource).not.toContain("tabindex");
    expect(indicatorSource).not.toContain("<button");
    expect(indicatorSource).toContain("width: 6px");
    expect(indicatorSource).toContain("height: 6px");
    expect(indicatorSource).toContain("var(--color-solar-ink)");
    expect(indicatorSource).not.toContain("var(--color-solar)");
    expect(indicatorSource).toContain("var(--rounded-full)");
  });

  it("uses the pulse token and holds steady under reduced motion", () => {
    expect(indicatorSource).toContain("var(--motion-pulse) ease-in-out");
    expect(indicatorSource).toContain("@keyframes live-indicator-pulse");
    expect(indicatorSource).toContain("opacity: 0.4");
    expect(indicatorSource).toContain(
      "@media (prefers-reduced-motion: reduce)",
    );
    expect(indicatorSource).toMatch(
      /prefers-reduced-motion[\s\S]*animation:\s*none[\s\S]*opacity:\s*1/,
    );
  });

  it("uses label-caps dim for LIVE and label-caps-lg dim for CLOSED", () => {
    expect(indicatorSource).toContain("var(--type-label-caps-size)");
    expect(indicatorSource).toContain("var(--type-label-caps-lg-size)");
    expect(indicatorSource).toContain("color: var(--color-dim)");
    expect(indicatorSource).not.toContain("--color-faint");
  });

  it("steps only the CLOSED word up to label-caps-lg, not the totals slot", () => {
    expect(indicatorSource).toMatch(
      /\.live-indicator\.is-closed \.live-indicator-state\s*\{[^}]*var\(--type-label-caps-lg-size\)/,
    );
  });
});

describe("Results Tally live region contract", () => {
  it("renders exactly one persistent polite region with transient slots", () => {
    expect(tallySource.match(/aria-live="polite"/g)).toHaveLength(1);
    expect(tallySource).toContain("data-results-live-region");
    expect(tallySource).toContain("data-live-status-content");
    expect(tallySource).toContain("data-live-stale");
    expect(tallySource).toContain("data-live-announcement");
  });

  it("places the totals line below the multi-select summary and above the bars", () => {
    expect(tallySource).toMatch(
      /results-tally-summary[\s\S]*data-results-live-region[\s\S]*data-tally-final/,
    );
  });

  it("styles the stale notice as label-caps-lg text and keeps CLOSED out of faint", () => {
    expect(tallySource).toContain(
      "Not receiving updates. The counts shown are from",
    );
    expect(tallySource).toMatch(
      /results-tally-stale[\s\S]*var\(--type-label-caps-lg-size\)[\s\S]*color:\s*var\(--color-text\)/,
    );
    expect(tallySource).not.toContain("--color-faint");
  });
});
