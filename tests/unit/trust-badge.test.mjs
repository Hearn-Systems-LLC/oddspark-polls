import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const badgeSource = readFileSync("src/components/trust-badge.astro", "utf8");
const badgeLogicSource = readFileSync("src/components/trust-badge.ts", "utf8");
const tokensSource = readFileSync("src/styles/tokens.css", "utf8");
const voteSurfaceSource = readFileSync(
  "src/components/poll-voting-surface.astro",
  "utf8",
);
const tallySource = readFileSync("src/components/results-tally.astro", "utf8");
const resultsPageSource = readFileSync(
  "src/pages/[reference]/results.astro",
  "utf8",
);
const liveReconcilerSource = readFileSync("src/scripts/results-live.ts", "utf8");

describe("trust badge component contract (Story 2.4, UX-DR7)", () => {
  it("binds every visual to the --trust-badge-* token group, never raw values", () => {
    expect(tokensSource).toContain("--trust-badge-gap:");
    expect(tokensSource).toContain("--trust-badge-border-top:");
    expect(tokensSource).toContain("--trust-badge-padding-y:");
    expect(tokensSource).toContain("--trust-badge-color:");
    expect(tokensSource).toContain("--trust-badge-glyph-color:");
    // Token group binds only to existing collapsed runtime vars.
    expect(tokensSource).toMatch(
      /--trust-badge-border-top:\s*var\(--space-hairline\) solid var\(--color-rule\)/,
    );
    expect(tokensSource).toMatch(/--trust-badge-color:\s*var\(--color-text\)/);
    expect(tokensSource).toMatch(
      /--trust-badge-glyph-color:\s*var\(--color-entropy\)/,
    );
    expect(tokensSource).toMatch(/--trust-badge-gap:\s*var\(--space-2\)/);
    expect(tokensSource).toMatch(/--trust-badge-padding-y:\s*var\(--space-3\)/);
    // The token group adds no new mode-suffixed pairs.
    expect(tokensSource).not.toMatch(/--trust-badge-[a-z-]+-(dark|light)\b/);
  });

  it("renders in label-caps-lg text — 12px, never the 11px dim label-caps class", () => {
    expect(badgeSource).toContain("var(--type-label-caps-lg-size)");
    expect(badgeSource).toContain("var(--font-machine)");
    expect(badgeSource).toContain("var(--type-label-caps-lh)");
    expect(badgeSource).toContain("var(--type-label-caps-ls)");
    expect(badgeSource).toContain("text-transform: uppercase");
    expect(badgeSource).not.toContain('class="label-caps"');
    expect(badgeSource).not.toContain("label-caps ");
  });

  it("keeps the entropy glyph decorative, one type step below the text", () => {
    expect(badgeSource).toContain("▪");
    expect(badgeSource).toMatch(/aria-hidden="true"[\s\S]*▪|▪[\s\S]*aria-hidden/);
    expect(badgeSource).toMatch(
      /trust-badge-glyph[\s\S]*var\(--trust-badge-glyph-color\)/,
    );
    expect(badgeSource).toMatch(
      /trust-badge-glyph[\s\S]*var\(--type-label-caps-size\)/,
    );
  });

  it("carries a hairline above and nothing else — no border, chip, or shadow", () => {
    expect(badgeSource).toContain("border-top: var(--trust-badge-border-top)");
    expect(badgeSource).not.toContain("border-radius");
    expect(badgeSource).not.toContain("box-shadow");
    expect(badgeSource).not.toMatch(/border-(left|right|bottom):/);
    expect(badgeSource).not.toContain("background");
  });

  it("uses a semantic list so screen readers announce item count", () => {
    expect(badgeSource).toContain("<ul");
    expect(badgeSource).toContain("<li");
    expect(badgeSource).toContain("list-style: none");
  });

  it("never truncates, abbreviates, or fades an item", () => {
    expect(badgeSource).not.toContain("text-overflow");
    expect(badgeSource).not.toContain("overflow: hidden");
    expect(badgeSource).not.toContain("opacity:");
    expect(badgeSource).toContain("white-space: nowrap");
  });

  it("is still — no transition, animation, or raw hex anywhere", () => {
    expect(badgeSource).not.toContain("transition");
    expect(badgeSource).not.toContain("animation");
    expect(badgeSource).not.toContain("@keyframes");
    expect(badgeSource).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(badgeSource).not.toContain("set:html");
  });

  it("hangs the glyph outside the text column so wrapped lines align", () => {
    expect(badgeSource).toContain("grid-template-columns: auto 1fr");
    expect(badgeSource).toContain("flex-wrap: wrap");
  });

  it("joins fitting items with a trailing middot separator", () => {
    expect(badgeSource).toContain('content: " ·"');
    expect(badgeSource).toMatch(/:not\(:last-child\)::after/);
  });

  it("keys copy by SecurityToggle in the co-located logic module", () => {
    expect(badgeLogicSource).toContain("Record<SecurityToggle, string>");
    expect(badgeLogicSource).not.toContain("if (");
    expect(badgeSource).not.toContain("ONE VOTE PER");
  });

  it("exposes the data-trust-badge hook and a class escape hatch", () => {
    expect(badgeSource).toContain("data-trust-badge");
    expect(badgeSource).toContain("class?: string");
    expect(badgeSource).toContain('class:list={["trust-badge", className]}');
  });

  it("renders nothing at all — no wrapper, no hairline — when no toggle is enforced", () => {
    expect(badgeSource).toMatch(/items\.length > 0 && \(/);
  });

  it("sits immediately before the vote-action block on the writable ballot branch", () => {
    expect(voteSurfaceSource).toMatch(
      /<TrustBadge toggles=\{pollToggles\} \/>\s*<div class="vote-action">/,
    );
  });
});

describe("trust badge Tally composition contract (Story 2.4, AC #4)", () => {
  it("renders the badge after the bars, inside the live-reconciled Tally root", () => {
    expect(tallySource).toMatch(/data-results-tally[\s\S]*<TrustBadge/);
    expect(tallySource).toMatch(/data-tally-final[\s\S]*<TrustBadge/);
    expect(tallySource).toContain('class="results-tally-badge"');
    expect(tallySource).toMatch(
      /:global\(\.results-tally-badge\)\s*\{[^}]*margin-top:\s*var\(--space-6\)/,
    );
  });

  it("keeps the badge out of the live payload and the reconciler's mutation scope", () => {
    expect(liveReconcilerSource).not.toContain("trust-badge");
    expect(badgeSource).not.toContain("data-live");
    expect(badgeSource).not.toContain("data-tally");
  });

  it("threads persisted toggles to both Tally surfaces", () => {
    expect(voteSurfaceSource).toContain(
      "toggles={tallyOwnsBadge ? pollToggles : undefined}",
    );
    expect(resultsPageSource).toContain("toggles={view.securityToggles}");
  });

  it("places the post-vote badge with the bars in the desktop grid", () => {
    // The post-vote instance rises 32px (no --space-7; --space-8 is the token).
    expect(voteSurfaceSource).toMatch(
      /\.poll-shell\[data-post-vote="true"\] :global\(\.results-tally-badge\)\s*\{[^}]*margin-top:\s*var\(--space-8\)/,
    );
    // At lg the Tally dissolves (display: contents), so the badge is a direct
    // grid child and needs explicit placement with the bars; Share yields.
    expect(voteSurfaceSource).toMatch(
      /:global\(\.results-tally-badge\)\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*6;/,
    );
    expect(voteSurfaceSource).toMatch(
      /\.poll-shell\[data-post-vote="true"\] > \.share-block\s*\{[^}]*grid-row:\s*7;/,
    );
  });
});
