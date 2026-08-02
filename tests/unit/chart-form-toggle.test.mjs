import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const toggleSource = readFileSync(
  "src/components/chart-form-toggle.astro",
  "utf8",
);
const scriptSource = readFileSync("src/scripts/chart-form-toggle.ts", "utf8");
const tallySource = readFileSync("src/components/results-tally.astro", "utf8");
const pollPageSource = readFileSync("src/pages/[reference].astro", "utf8");
const resultsPageSource = readFileSync(
  "src/pages/[reference]/results.astro",
  "utf8",
);

describe("chart-form-toggle component contract (Story 1.10)", () => {
  it("renders two word buttons with aria-pressed in a labelled group", () => {
    expect(toggleSource.match(/<button\s+type="button"/g)).toHaveLength(2);
    expect(toggleSource).toContain('data-chart-form="bars"');
    expect(toggleSource).toContain('data-chart-form="pie"');
    expect(toggleSource).toContain('aria-pressed="true"');
    expect(toggleSource).toContain('aria-pressed="false"');
    expect(toggleSource).toContain('role="group"');
    expect(toggleSource).toContain('aria-label="Chart form"');
    expect(toggleSource).toContain(">BARS</button>");
    expect(toggleSource).toContain(">PIE</button>");
  });

  it("is two words and a rule — no icon, no box, no live region, no opacity", () => {
    expect(toggleSource).not.toContain("<svg");
    expect(toggleSource).not.toContain("<img");
    expect(toggleSource).not.toContain("aria-live");
    expect(toggleSource).not.toMatch(/^\s*opacity\s*:/m);
    expect(toggleSource).not.toContain("border-radius");
    expect(toggleSource).not.toContain("box-shadow");
  });

  it("binds every visual to the chart-form-toggle token family", () => {
    expect(toggleSource).toContain("var(--chart-form-toggle-color)");
    expect(toggleSource).toContain("var(--chart-form-toggle-color-current)");
    expect(toggleSource).toContain("var(--chart-form-toggle-gap)");
    expect(toggleSource).toContain("var(--chart-form-toggle-border-bottom)");
    expect(toggleSource).toContain("var(--chart-form-toggle-padding-y)");
    expect(toggleSource).toContain("var(--chart-form-toggle-min-height)");
    expect(toggleSource).toContain("var(--chart-form-toggle-focus-outline)");
    expect(toggleSource).toContain(
      "var(--chart-form-toggle-focus-outline-offset)",
    );
    expect(toggleSource).toContain("var(--chart-form-toggle-separator)");
    expect(toggleSource).toContain("var(--type-label-caps-size)");
    expect(toggleSource).toContain("var(--type-label-caps-ls)");
    expect(toggleSource).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("renders hidden by default with an explicit display guard", () => {
    expect(toggleSource).toMatch(
      /class="chart-form-toggle"[\s\S]*?aria-label="Chart form"\s*\n\s*hidden/,
    );
    expect(toggleSource).toMatch(
      /\.chart-form-toggle\[hidden\][\s\S]*?display:\s*none/,
    );
  });

  it("keeps the middot separator decorative and token-supplied", () => {
    expect(toggleSource).toMatch(
      /class="chart-form-toggle-separator" aria-hidden="true"/,
    );
    expect(toggleSource).toMatch(
      /content:\s*var\(--chart-form-toggle-separator\)/,
    );
  });

  it("provides the hidden mount point the pie renderer fills", () => {
    expect(toggleSource).toMatch(
      /class="chart-form-pie" data-chart-form-pie hidden/,
    );
  });
});

describe("chart-form-toggle tally wiring contract (Story 1.10)", () => {
  it("renders only on single-select Tallies, immediately before the bars", () => {
    expect(tallySource).toMatch(
      /!tally\.multiSelectEnabled && <ChartFormToggle \/>/,
    );
    expect(tallySource).toMatch(
      /data-results-live-region[\s\S]*ChartFormToggle[\s\S]*data-tally-final/,
    );
  });

  it("keeps the summary → live region → bars source order", () => {
    expect(tallySource).toMatch(
      /results-tally-summary[\s\S]*data-results-live-region[\s\S]*data-tally-final/,
    );
  });
});

describe("chart-form-toggle script contract (Story 1.10)", () => {
  it("reveals the server-hidden control and never persists the choice", () => {
    expect(scriptSource).toContain("toggle.hidden = false");
    expect(scriptSource).not.toMatch(/\blocalStorage\b/);
    expect(scriptSource).not.toMatch(/\bsessionStorage\b/);
    expect(scriptSource).not.toContain("document.cookie");
    expect(scriptSource).not.toContain("fetch(");
  });

  it("hides bars in place and requests a synchronous poller snap before re-entry", () => {
    expect(scriptSource).toContain("bars.hidden = pieActive");
    expect(scriptSource).toContain("root.dataset.chartFormState = form");
    expect(scriptSource).toContain("RESULTS_CHART_FORM_CHANGE_EVENT");
    expect(scriptSource.indexOf("dispatchEvent")).toBeLessThan(
      scriptSource.indexOf("render();", scriptSource.indexOf("dispatchEvent")),
    );
    expect(scriptSource).toContain('setAttribute("aria-pressed"');
    expect(scriptSource).toContain('classList.toggle("is-current"');
  });

  it("loads on every visible Tally on the direct Results route, not only open ones", () => {
    expect(resultsPageSource).toMatch(
      /view\.kind === "visible" && \(\s*<script src="\.\.\/\.\.\/scripts\/chart-form-toggle\.ts"><\/script>/,
    );
    // The poller stays gated on open; the toggle must not join that gate.
    expect(resultsPageSource).toMatch(
      /view\.status === "open"[\s\S]*?results-live\.ts/,
    );
  });

  it("loads alongside the poller on the post-vote surface", () => {
    expect(pollPageSource).toMatch(
      /showTally &&\s*\n?\s*postVoteResults\?\.kind === "visible" && \(\s*<script src="\.\.\/scripts\/chart-form-toggle\.ts"><\/script>/,
    );
    expect(pollPageSource).toMatch(
      /postVoteResults\.status === "open"[\s\S]*?results-live\.ts/,
    );
  });

  it("places the toggle and pie mount in the post-vote desktop grid", () => {
    expect(pollPageSource).toMatch(
      /:global\(\.chart-form-toggle\) \{[^}]*grid-column: 2;[^}]*grid-row: 4;/,
    );
    expect(pollPageSource).toMatch(
      /:global\(\.chart-form-pie\) \{[^}]*grid-column: 2;[^}]*grid-row: 5;/,
    );
  });
});
