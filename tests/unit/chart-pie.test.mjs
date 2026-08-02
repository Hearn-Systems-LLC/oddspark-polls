import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const barComponentSource = readFileSync(
  "src/components/results-bar.astro",
  "utf8",
);
const pollerSource = readFileSync("src/scripts/results-live.ts", "utf8");
const toggleScriptSource = readFileSync(
  "src/scripts/chart-form-toggle.ts",
  "utf8",
);
const toggleComponentSource = readFileSync(
  "src/components/chart-form-toggle.astro",
  "utf8",
);

describe("pie data wiring contract (Story 1.10)", () => {
  it("server-renders display values and exact PIE share on the bar root", () => {
    expect(barComponentSource).toContain("data-percent={normalizedPercent}");
    expect(barComponentSource).toContain("data-count={count}");
    expect(barComponentSource).toContain("data-pie-share={pieShare}");
  });

  it("keeps the track style exactly the width custom property", () => {
    // results.spec.mjs asserts the track's style attribute equals
    // "--bar-width: N%" byte-for-byte — the pie data never goes there.
    expect(barComponentSource).toContain("style={`--bar-width: ${width}%`}");
    expect(barComponentSource).not.toMatch(
      /results-bar-track[^>]*data-percent/,
    );
  });

  it("keeps the attributes current in the reconcile pass at final values", () => {
    expect(pollerSource).toContain("dataset.percent");
    expect(pollerSource).toContain("dataset.count");
    expect(pollerSource).toContain("dataset.pieShare");
  });
});

describe("pie renderer contract (Story 1.10)", () => {
  it("builds the SVG with DOM APIs and marks it decorative", () => {
    expect(toggleScriptSource).toContain("createElementNS");
    expect(toggleScriptSource).not.toContain("innerHTML");
    expect(toggleScriptSource).toContain('setAttribute("aria-hidden", "true")');
  });

  it("reuses the bar accessible-name format for legend rows", () => {
    expect(toggleScriptSource).toMatch(
      /import \{ barAccessibleName \} from "\.\.\/components\/results-bar";/,
    );
    expect(toggleScriptSource).toContain("barAccessibleName(");
  });

  it("renders geometry from server-owned share, never recomputed counts", () => {
    expect(toggleScriptSource).toContain("dataset.percent");
    expect(toggleScriptSource).toContain("dataset.count");
    expect(toggleScriptSource).toContain("dataset.pieShare");
    expect(toggleScriptSource).toMatch(
      /pieSlices\(entries\.map\(\(entry\) => entry\.pieShare\)\)/,
    );
    expect(toggleScriptSource).not.toMatch(
      /\/\s*(voterCount|total|selectionCount)/,
    );
  });

  it("re-renders live via a MutationObserver over the bar attributes", () => {
    expect(toggleScriptSource).toContain("MutationObserver");
    expect(toggleScriptSource).toMatch(
      /attributeFilter:\s*\[[\s\S]*"data-percent"[\s\S]*"data-count"[\s\S]*"data-pie-share"/,
    );
  });

  it("updates option-keyed accessible legend rows instead of replacing them", () => {
    expect(toggleScriptSource).toContain("const legendRows = new Map");
    expect(toggleScriptSource).toContain("row.dataset.optionId = entry.id");
    expect(toggleScriptSource).not.toContain("pie.replaceChildren()");
  });

  it("adds no interactive elements to the pie view", () => {
    expect(toggleScriptSource).not.toMatch(
      /createElement\("(button|input|select|textarea|a)"\)/,
    );
  });
});

describe("pie presentation contract (Story 1.10)", () => {
  it("binds slice colors and the boundary hairline to tokens", () => {
    expect(toggleComponentSource).toContain("var(--color-entropy-wash)");
    expect(toggleComponentSource).toContain("var(--color-panel)");
    expect(toggleComponentSource).toContain("var(--color-solar-wash)");
    expect(toggleComponentSource).toContain("var(--color-rule)");
    expect(toggleComponentSource).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("marks legend leadership with the shared leader-marker token", () => {
    expect(toggleComponentSource).toContain(
      "var(--results-bar-leader-marker-color)",
    );
  });

  it("declares no motion anywhere in the chart-form surface", () => {
    expect(toggleComponentSource).not.toMatch(/^\s*transition\s*:/m);
    expect(toggleComponentSource).not.toMatch(/^\s*animation\s*:/m);
    expect(toggleComponentSource).not.toContain("@keyframes");
  });

  it("keeps the legend in the bar-value typography with tabular figures", () => {
    expect(toggleComponentSource).toContain("var(--type-data-size)");
    expect(toggleComponentSource).toContain("var(--type-caption-size)");
    expect(toggleComponentSource).toContain("tabular-nums");
  });
});
