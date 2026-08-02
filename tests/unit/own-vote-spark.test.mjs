import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const barComponentSource = readFileSync(
  "src/components/results-bar.astro",
  "utf8",
);
const tallySource = readFileSync("src/components/results-tally.astro", "utf8");
const pollPageSource = readFileSync("src/pages/[reference].astro", "utf8");
const resultsPageSource = readFileSync(
  "src/pages/[reference]/results.astro",
  "utf8",
);
const toggleScriptSource = readFileSync(
  "src/scripts/chart-form-toggle.ts",
  "utf8",
);
const sparkSource = readFileSync("src/scripts/results-spark.ts", "utf8");

describe("own-vote spark wiring contract (Story 1.10, AC #6)", () => {
  it("threads yourBallotOptionIds from the counted confirmation into ResultsTally", () => {
    expect(pollPageSource).toContain("yourBallotOptionIds");
    expect(pollPageSource).toMatch(
      /yourBallotOptionIds = selections\.map\(\(option\) => option\.id\)/,
    );
    // Only the fresh confirmation render marks bars — an already-voted or
    // replayed visit keeps the paint still.
    expect(pollPageSource).toMatch(
      /yourBallotOptionIds=\{\s*outcome\?\.code === "counted" \? yourBallotOptionIds : undefined\s*\}/,
    );
  });

  it("emits data-your-option only through the ResultsBar prop", () => {
    expect(tallySource).toContain("yourBallotOptionIds?: PollOptionId[]");
    expect(tallySource).toMatch(
      /yourOption=\{yourBallotOptionIds\.includes\(option\.id\)\}/,
    );
    expect(barComponentSource).toContain("yourOption?: boolean");
    expect(barComponentSource).toMatch(
      /data-your-option=\{yourOption \? "true" : undefined\}/,
    );
  });

  it("never marks the cold-load skeleton bars", () => {
    const skeletonBlock = tallySource.match(
      /data-tally-skeleton[\s\S]*?<\/div>/,
    );
    expect(skeletonBlock).not.toBeNull();
    expect(skeletonBlock?.[0]).not.toContain("yourOption");
  });

  it("keeps YOUR BALLOT text-only — the marker never adds gold or a second ◆", () => {
    const classList = barComponentSource.match(/class:list=\{\[([\s\S]*?)\]\}/);
    expect(classList).not.toBeNull();
    expect(classList?.[1]).not.toContain("yourOption");
    expect(tallySource).toContain('yourBallotLabels.join(" · ")');
  });

  it("leaves the shared Results route without any own-option marker", () => {
    expect(resultsPageSource).not.toContain("yourBallotOptionIds");
  });
});

describe("own-vote spark firing contract (Story 1.10, AC #6)", () => {
  it("fires from the always-loaded toggle script, independent of the toggle", () => {
    expect(toggleScriptSource).toContain("[data-your-option]");
    // The spark runs even where the toggle itself is absent (multi-select),
    // so it must not live behind the toggle early-return.
    const sparkIndex = toggleScriptSource.indexOf("sparkOwnBallot(root)");
    const enhanceIndex = toggleScriptSource.indexOf("enhanceChartFormToggle(root)");
    expect(sparkIndex).toBeGreaterThanOrEqual(0);
    expect(enhanceIndex).toBeGreaterThan(sparkIndex);
  });

  it("waits a double rAF so it fires after the cold-load reveal", () => {
    expect(toggleScriptSource).toMatch(
      /\[data-your-option\][\s\S]*requestAnimationFrame\(\(\) => \{\s*window\.requestAnimationFrame/,
    );
  });

  it("sparks every selected bar simultaneously with one style flush", () => {
    expect(toggleScriptSource).toContain("prepareResultsSparks(fills)");
    expect(toggleScriptSource).toMatch(/offsetWidth;\s*startSparks\(\)/);
    expect(sparkSource).toContain('classList.remove(SPARK_CLASS)');
    expect(sparkSource).toContain('classList.add(SPARK_CLASS)');
    expect(sparkSource).toContain('addEventListener("animationend", finish)');
  });

  it("omits the spark entirely under reduced motion", () => {
    expect(toggleScriptSource).toMatch(
      /prefers-reduced-motion: reduce[\s\S]*?data-your-option|data-your-option[\s\S]*?prefers-reduced-motion: reduce/,
    );
  });
});
