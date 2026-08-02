import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const barSource = readFileSync("src/components/results-bar.astro", "utf8");
const tokensSource = readFileSync("src/styles/tokens.css", "utf8");
const pollerSource = readFileSync("src/scripts/results-live.ts", "utf8");
const motionCoreSource = readFileSync(
  "src/scripts/results-motion-core.ts",
  "utf8",
);

function modeCollapseBlock(source, openerPattern) {
  const match = source.match(openerPattern);
  expect(match, `mode-collapse block matching ${openerPattern}`).not.toBeNull();
  return match[1];
}

const darkRuntime = () =>
  modeCollapseBlock(tokensSource, /:root,\s*\[data-mode="dark"\] \{([^}]*)\}/);
const lightRuntime = () =>
  modeCollapseBlock(tokensSource, /\[data-mode="light"\] \{([^}]*)\}/);
const prefersLight = () =>
  modeCollapseBlock(
    tokensSource,
    /@media \(prefers-color-scheme: light\) \{\s*:root:not\(\[data-mode\]\) \{([^}]*)\}/,
  );
const prefersDark = () =>
  modeCollapseBlock(
    tokensSource,
    /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-mode\]\) \{([^}]*)\}/,
  );

describe("results bar motion CSS contract (Story 1.10)", () => {
  it("gates width and leader cross-fade transitions behind the armed tally root", () => {
    expect(barSource).toMatch(
      /\.results-tally\.is-motion-armed \[data-tally-final\]\) \.results-bar-fill \{\s*transition:\s*width var\(--motion-bar-transition\) var\(--motion-ease\),\s*background-color var\(--motion-leader-crossfade\) var\(--motion-ease\),\s*border-right-color var\(--motion-leader-crossfade\) var\(--motion-ease\);/,
    );
    // The arming class is added by script after first paint; the header
    // comment must not still claim a transition-free component.
    expect(barSource).not.toContain("no CSS transition in this story");
  });

  it("references motion tokens by var name, never literal durations", () => {
    expect(barSource).not.toMatch(/\d+ms/);
    expect(barSource).toContain("var(--motion-bar-transition)");
    expect(barSource).toContain("var(--motion-leader-crossfade)");
    expect(barSource).toContain("var(--motion-spark)");
    expect(barSource).toContain("var(--motion-ease)");
  });

  it("fires the spark via a short-lived is-spark class on the fill", () => {
    expect(barSource).toMatch(
      /\[data-tally-final\]\) \.results-bar-fill\.is-spark \{\s*animation: results-bar-spark var\(--motion-spark\) ease-in-out;/,
    );
    expect(barSource).toMatch(
      /@keyframes results-bar-spark \{[\s\S]*border-right-width: var\(--results-bar-leading-edge-width\);[\s\S]*border-right-width: var\(--results-bar-leading-edge-width-spark\);[\s\S]*\}/,
    );
  });

  it("scopes every motion rule to the final bar group, never the skeleton", () => {
    expect(barSource).not.toContain("[data-tally-skeleton]");
    const globalSelectors = barSource.match(/:global\([^)]*\)[^,{]*\{/g) ?? [];
    const motionSelectors = globalSelectors.filter(
      (selector) =>
        selector.includes("is-motion-armed") || selector.includes("is-spark"),
    );
    expect(motionSelectors.length).toBeGreaterThan(0);
    for (const selector of motionSelectors) {
      expect(selector).toContain("[data-tally-final]");
    }
  });

  it("zeroes every new transition and animation under reduced motion", () => {
    const reducedMotionIndex = barSource.indexOf(
      "@media (prefers-reduced-motion: reduce)",
    );
    expect(reducedMotionIndex).toBeGreaterThanOrEqual(0);
    const reducedMotionBlock = barSource.slice(reducedMotionIndex);
    expect(reducedMotionBlock).toContain("transition: none");
    expect(reducedMotionBlock).toContain("animation: none");
  });

  it("pins the value cluster to tabular figures without changing its color", () => {
    const valueBlock = barSource.match(/\.results-bar-value \{([^}]*)\}/);
    expect(valueBlock).not.toBeNull();
    expect(valueBlock[1]).toContain("font-variant-numeric: tabular-nums");
    expect(valueBlock[1]).toContain("color: var(--color-text)");
    expect(barSource).toMatch(
      /\.results-bar-pct \{[\s\S]*?inline-size: 4ch;[\s\S]*?text-align: right;/,
    );
    expect(barSource).toMatch(
      /\.results-bar-count \{[\s\S]*?min-inline-size: 6ch;[\s\S]*?text-align: right;/,
    );
    expect(pollerSource).toContain("reserveTargetWidth(target)");
  });
});

describe("tokens.css motion foundation (Story 1.10)", () => {
  it("declares the spark leading-edge width alongside the base edge width", () => {
    expect(tokensSource).toMatch(
      /--results-bar-leading-edge-width: 2px;\s*\n\s*--results-bar-leading-edge-width-spark: 4px;/,
    );
  });

  it.each([
    "--chart-form-toggle-color",
    "--chart-form-toggle-color-current",
    "--chart-form-toggle-border-bottom",
    "--chart-form-toggle-focus-outline",
  ])("collapses %s through all four mode positions", (token) => {
    for (const block of [
      darkRuntime(),
      lightRuntime(),
      prefersLight(),
      prefersDark(),
    ]) {
      expect(block).toContain(`${token}:`);
    }
  });

  it("binds dark sources in the dark positions and light sources in the light positions", () => {
    expect(darkRuntime()).toContain(
      "--chart-form-toggle-color: var(--color-dim-dark);",
    );
    expect(prefersDark()).toContain(
      "--chart-form-toggle-color: var(--color-dim-dark);",
    );
    expect(lightRuntime()).toContain(
      "--chart-form-toggle-color: var(--color-dim-light);",
    );
    expect(prefersLight()).toContain(
      "--chart-form-toggle-color: var(--color-dim-light);",
    );
    expect(darkRuntime()).toContain(
      "--chart-form-toggle-color-current: var(--color-solar-ink-dark);",
    );
    expect(lightRuntime()).toContain(
      "--chart-form-toggle-color-current: var(--color-solar-ink-light);",
    );
  });

  it("declares the mode-independent chart-form-toggle tokens at the source", () => {
    expect(tokensSource).toContain('--chart-form-toggle-separator: "·";');
    expect(tokensSource).toContain("--chart-form-toggle-gap: var(--space-2);");
    expect(tokensSource).toContain(
      "--chart-form-toggle-padding-y: var(--space-2);",
    );
    expect(tokensSource).toContain("--chart-form-toggle-min-height: 48px;");
    expect(tokensSource).toContain(
      "--chart-form-toggle-focus-outline-offset: 2px;",
    );
  });

  it("retires the story-1.1 motion comment and keeps the deploy-gate solar token", () => {
    expect(tokensSource).not.toContain("nothing animates in story 1.1");
    expect(tokensSource).toContain("--color-solar-dark: #c9a227;");
  });

  it("keeps the named easing token as the count-up curve's one source", () => {
    expect(tokensSource.match(/--motion-ease:/g)).toHaveLength(1);
    expect(pollerSource).toContain(
      'getComputedStyle(root).getPropertyValue("--motion-ease")',
    );
    expect(pollerSource).toContain("parseMotionEasing");
    expect(motionCoreSource).not.toContain("0.22, 1, 0.36, 1");
    expect(motionCoreSource).toContain("easing: CubicBezierCurve");
  });
});
