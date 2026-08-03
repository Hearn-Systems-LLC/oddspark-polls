import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const badgeSource = readFileSync("src/components/listing-badge.astro", "utf8");
const tokensSource = readFileSync("src/styles/tokens.css", "utf8");
const detailPageSource = readFileSync(
  "src/pages/creator/polls/[pollId].astro",
  "utf8",
);

describe("listing badge component contract (Story 3.1, UX-DR12)", () => {
  it("binds all three states to collapsed listing badge tokens", () => {
    expect(tokensSource).toMatch(
      /--listing-badge-unlisted-color:\s*var\(--color-dim\)/,
    );
    expect(tokensSource).toMatch(
      /--listing-badge-listed-color:\s*var\(--color-entropy\)/,
    );
    expect(tokensSource).toMatch(
      /--listing-badge-delisted-color:\s*var\(--color-alarm\)/,
    );
    expect(tokensSource).not.toMatch(
      /--listing-badge-[a-z-]+-(dark|light)\b/,
    );
    for (const state of ["unlisted", "listed", "delisted"]) {
      expect(badgeSource).toContain(`[data-state="${state}"]`);
    }
  });

  it("renders canonical word-first state copy in label-caps-lg type", () => {
    for (const word of ["UNLISTED", "LISTED", "DELISTED"]) {
      expect(badgeSource).toContain(word);
    }
    expect(badgeSource).toContain("var(--font-machine)");
    expect(badgeSource).toContain("var(--type-label-caps-lg-size)");
    expect(badgeSource).toContain("var(--type-label-caps-lh)");
    expect(badgeSource).toContain("var(--type-label-caps-ls)");
    expect(badgeSource).toContain("text-transform: uppercase");
  });

  it("is plain still text with no chip or unsafe rendering", () => {
    expect(badgeSource).toContain("<span");
    expect(badgeSource).toContain("data-listing-badge");
    expect(badgeSource).toContain("class?: string");
    expect(badgeSource).toContain(
      'class:list={["listing-badge", className]}',
    );
    expect(badgeSource).not.toContain("set:html");
    expect(badgeSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(badgeSource).not.toContain("opacity:");
    expect(badgeSource).not.toContain("border:");
    expect(badgeSource).not.toContain("border-radius");
    expect(badgeSource).not.toContain("box-shadow");
    expect(badgeSource).not.toContain("background:");
    expect(badgeSource).not.toContain("transition");
    expect(badgeSource).not.toContain("animation");
  });

  it("is composed beside the detail status instead of reimplemented", () => {
    expect(detailPageSource).toContain("ListingBadge");
    expect(detailPageSource).toContain("state={listingState}");
    expect(detailPageSource).not.toContain("listingState.toUpperCase()");
  });
});
