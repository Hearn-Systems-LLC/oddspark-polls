import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const votingSurfaceSource = readFileSync(
  "src/components/poll-voting-surface.astro",
  "utf8",
);
const landingSource = readFileSync("src/pages/index.astro", "utf8");
const resultsRouteSource = readFileSync(
  "src/pages/[reference]/results.astro",
  "utf8",
);
const tokensSource = readFileSync("src/styles/tokens.css", "utf8");

describe("desktop two-column layout contract (DESIGN.md §Layout)", () => {
  describe("poll voting surface split-tally state", () => {
    it("derives splitTally as showTally && !compactCounted", () => {
      // Pre-vote / editable Tally splits at lg; post-vote keeps the existing
      // data-post-vote grid. The two states must never co-occur.
      expect(votingSurfaceSource).toMatch(
        /const splitTally = showTally && !compactCounted;/,
      );
    });

    it("emits data-split-tally only when the split state holds", () => {
      expect(votingSurfaceSource).toContain(
        'data-split-tally={splitTally ? "true" : undefined}',
      );
    });

    it("splits form left and Tally right at the lg breakpoint", () => {
      expect(votingSurfaceSource).toMatch(
        /@media \(min-width: 1024px\) \{[\s\S]*\.poll-shell\[data-split-tally="true"\] \{ display: grid;/,
      );
      expect(votingSurfaceSource).toMatch(
        /\.poll-shell\[data-split-tally="true"\] > \.tally-region \{ grid-column: 2;/,
      );
    });

    it("keeps the post-vote grid gated on data-post-vote and unchanged", () => {
      expect(votingSurfaceSource).toContain(
        '.poll-shell[data-post-vote="true"]:not(.is-embedded) { display: grid; grid-template-columns: 320px 1fr;',
      );
    });
  });

  describe("landing page lg grid", () => {
    it("pins columns to the server-side regionOrder via a demo-first modifier", () => {
      expect(landingSource).toContain(
        'outcomeBearing && "landing-page--demo-first"',
      );
      expect(landingSource).toMatch(
        /\.landing-page--demo-first \[data-demo-region\] \{ grid-column: 1; \}/,
      );
    });

    it("widens only the landing shell at lg via the wide measure token", () => {
      expect(landingSource).toMatch(
        /\.site-shell:has\(\.landing-page\) \{ max-width: var\(--space-measure-wide\); \}/,
      );
    });

    it("places the Demo Poll beside the intro column at lg", () => {
      expect(landingSource).toMatch(
        /\.landing-page \{ display: grid; grid-template-columns: minmax\(280px, 1fr\) minmax\(0, 2fr\);/,
      );
      expect(landingSource).toMatch(
        /\[data-demo-region\] \{ grid-column: 2; grid-row: 1 \/ span 10;/,
      );
    });
  });

  describe("standalone results route lg grid", () => {
    it("splits question/context left and results region right at lg", () => {
      expect(resultsRouteSource).toMatch(
        /@media \(min-width: 1024px\) \{[\s\S]*\.results-shell \{[\s\S]*display: grid;/,
      );
      expect(resultsRouteSource).toMatch(
        /\[data-results-region\] \{[\s\S]*grid-column: 2;/,
      );
      expect(resultsRouteSource).toMatch(
        /width: min\(100%, var\(--space-measure-wide\)\);/,
      );
    });
  });

  describe("design token", () => {
    it("declares --space-measure-wide beside --space-measure", () => {
      expect(tokensSource).toMatch(/--space-measure: 68ch;/);
      expect(tokensSource).toMatch(/--space-measure-wide: 1280px;/);
    });
  });
});
