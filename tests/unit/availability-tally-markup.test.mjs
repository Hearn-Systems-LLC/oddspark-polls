import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  "src/components/availability-tally.astro",
  "utf8",
);

describe("Meeting availability tally markup contract", () => {
  it("renders every state with the shared glyph and wash vocabulary", () => {
    expect(source).toMatch(
      /\.availability-cell::before\s*\{[^}]*color: var\(--color-faint\);[^}]*content: "·";/s,
    );
    expect(source).toMatch(
      /\.availability-cell\.is-yes\.is-selected\s*\{[^}]*background: var\(--color-solar-wash\);/s,
    );
    expect(source).toMatch(
      /\.availability-cell\.is-yes\.is-selected::before\s*\{[^}]*color: var\(--availability-solar-ink\);[^}]*content: "✓";/s,
    );
    expect(source).toMatch(
      /\.availability-cell\.is-if_need_be\.is-selected\s*\{[^}]*background: var\(--color-entropy-wash\);/s,
    );
    expect(source).toMatch(
      /\.availability-cell\.is-if_need_be\.is-selected::before\s*\{[^}]*color: var\(--color-entropy\);[^}]*content: "~";/s,
    );
    expect(source).toMatch(
      /\.availability-cell\.is-no\.is-selected::before\s*\{[^}]*color: var\(--color-dim\);[^}]*content: "×";/s,
    );
  });

  it("keeps cells square, collapsed, and token-driven", () => {
    const cell = source.match(/\.availability-cell\s*\{([^}]*)\}/s)?.[1] ?? "";
    expect(cell).toContain("width: 48px");
    expect(cell).toContain("height: 48px");
    expect(cell).toContain("margin-left: -1px");
    expect(cell).toContain("border-radius: 0");
    expect(cell).toContain("border: 1px solid var(--color-rule)");
  });

  it("shows authored names safely and aligned unanswered cells", () => {
    expect(source).toContain("{voter.displayName}");
    expect(source).not.toContain("set:html");
    expect(source).toContain('stateLabel(state)');
    expect(source).toContain('stateClass(state)');
    expect(source).toContain('"Unanswered"');
  });

  it("renders distinct data-type totals and a gold rule on every best slot", () => {
    expect(source).toContain("YES {slot.yesCount}");
    expect(source).toContain("IF NEED BE {slot.ifNeedBeCount}");
    expect(source).toMatch(
      /\.slot-totals\s*\{[^}]*font-size: var\(--type-data-size\);[^}]*font-weight: 700;/s,
    );
    expect(source).toContain('slot.isBest && "is-best"');
    expect(source).toMatch(
      /\.is-best\s*\{[^}]*border-top: 2px solid var\(--color-solar-ink\);/s,
    );
    expect(source).not.toContain("◆");
  });

  it("duplicates complete information for mobile and desktop at the lg breakpoint", () => {
    expect(source).toContain("meeting-tally-mobile");
    expect(source).toContain("meeting-tally-matrix");
    expect(source).toContain("@media (min-width: 1024px)");
    expect(source).toMatch(
      /\.meeting-tally-mobile\s*\{[^}]*display: grid;/s,
    );
    expect(source).toMatch(
      /\.meeting-tally-matrix\s*\{[^}]*display: none;/s,
    );
  });

  it("emits the reusable timezone attributes and a fixed Creator branch", () => {
    for (const attribute of [
      "data-availability-grid",
      "data-timezone-label",
      "data-timezone-select",
      "data-slot",
      "data-starts-at",
      "data-ends-at",
      "data-source-zone",
      "data-local-time",
      "data-day-shift",
    ]) {
      expect(source).toContain(attribute);
    }
    expect(source).toContain("creatorTimeZone");
    expect(source).toContain("isUsableTimeZone");
    expect(source).toContain("+1 day");
  });

  it("renders the Results-owned empty copy instead of a grid skeleton", () => {
    expect(source).toContain("RESULTS_COPY.empty");
    expect(source).toContain("meeting.empty");
    expect(source).not.toContain("skeleton");
    expect(source).not.toContain('type="radio"');
    expect(source).not.toMatch(/auto-?commit|confirm slot/i);
  });
});
