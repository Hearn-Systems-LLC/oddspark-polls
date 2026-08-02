// Presentation helpers for results-bar.astro — pure so the unit project can
// pin them without rendering a component.

// The bar's one normalized percentage feeds width, visible text, and its
// accessible name. Non-finite input (NaN/Infinity) and out-of-range values
// normalize to a renderable 0–100. Zero suppresses the 2px leading edge in
// the component while the baseline and label remain.
export function barWidthPercent(percent: number): number {
  if (!Number.isFinite(percent)) {
    return 0;
  }
  return Math.max(0, Math.min(100, percent));
}

// The established accessible-name form (EXPERIENCE.md § Accessibility
// Floor): "Pizza, 47 percent, 122 votes, leading" — the leader suffix is
// omitted for every non-leading bar, and the decorative ◆ never enters the
// name. State is never color-only. The count pluralizes ("1 vote").
export function barAccessibleName(
  label: string,
  percent: number,
  count: number,
  leading: boolean,
): string {
  const votes = count === 1 ? "1 vote" : `${count} votes`;
  return `${label}, ${percent} percent, ${votes}${leading ? ", leading" : ""}`;
}
