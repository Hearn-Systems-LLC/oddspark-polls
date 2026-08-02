import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const cardSource = readFileSync("src/components/poll-card.astro", "utf8");
const presenterSource = readFileSync("src/components/poll-card.ts", "utf8");
const tokensSource = readFileSync("src/styles/tokens.css", "utf8");
const creatorPageSource = readFileSync("src/pages/creator/index.astro", "utf8");
const detailPageSource = readFileSync(
  "src/pages/creator/polls/[pollId].astro",
  "utf8",
);

describe("poll-card tokens (Story 1.11)", () => {
  it("defines the poll-card family in a single :root component block", () => {
    expect(tokensSource).toContain("--poll-card-background: transparent");
    expect(tokensSource).toContain(
      "--poll-card-padding-y: var(--space-6)",
    );
    expect(tokensSource).toContain(
      "--poll-card-border-top: var(--space-hairline) solid var(--color-rule)",
    );
    expect(tokensSource).toContain(
      "--poll-card-title-size: var(--type-poll-question-size)",
    );
    expect(tokensSource).toContain(
      "--poll-card-meta-color: var(--color-dim)",
    );
    expect(tokensSource).toContain(
      "--poll-card-status-color: var(--color-dim)",
    );
    // Never rename solar-dark — smoke extracts it.
    expect(tokensSource).toContain("--color-solar-dark:");
  });
});

describe("poll-card component contract (Story 1.11)", () => {
  it("is one block-level link row with no secondary interactive controls", () => {
    expect(cardSource.match(/<a\b/g)).toHaveLength(1);
    expect(cardSource).not.toMatch(/<button\b/);
    expect(cardSource).not.toMatch(/<input\b/);
    expect(cardSource).not.toContain("set:html");
    expect(cardSource).toContain("data-poll-card");
  });

  it("binds visuals to the poll-card token family", () => {
    expect(cardSource).toContain("var(--poll-card-padding-y)");
    expect(cardSource).toContain("var(--poll-card-border-top)");
    expect(cardSource).toContain("var(--poll-card-background)");
    expect(cardSource).toContain("var(--poll-card-title-font)");
    expect(cardSource).toContain("var(--poll-card-title-size)");
    expect(cardSource).toContain("var(--poll-card-meta-color)");
    expect(cardSource).toContain("var(--poll-card-status-color)");
    expect(cardSource).toContain("var(--focus-outline)");
    expect(cardSource).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });

  it("uses a top hairline and never styles CLOSED as faint", () => {
    expect(cardSource).toContain("border-top: var(--poll-card-border-top)");
    expect(cardSource).toContain(">CLOSED</span>");
    expect(cardSource).not.toContain("--color-faint");
    expect(cardSource).not.toContain("var(--color-faint)");
  });

  it("renders LiveIndicator for open and CLOSED text for closed", () => {
    expect(cardSource).toContain('status === "open"');
    expect(cardSource).toContain("LiveIndicator");
    expect(cardSource).toContain('status="open"');
  });

  it("renders structured metadata without reparsing display copy", () => {
    expect(presenterSource).toContain("buildPollCardViewModel");
    expect(cardSource).toContain("metadata.typeLabel");
    expect(cardSource).toContain("metadata.voteTotal");
    expect(cardSource).toContain('metadata.closing.kind === "countdown"');
    expect(cardSource).toContain('metadata.closing.kind === "absolute"');
    expect(cardSource).not.toContain("metaLine");
    expect(cardSource).not.toContain(".replace(");
  });
});

describe("creator dashboard surface contracts (Story 1.11)", () => {
  it("wires aria-current on selected rows and a 1024px two-column grid on detail", () => {
    // Selection is navigation; aria-current lives on the row component.
    expect(cardSource).toContain('aria-current={current ? "page" : undefined}');
    expect(detailPageSource).toContain(
      "current: poll !== null && row.pollId === pollId",
    );
    expect(detailPageSource).toContain("<PollCard viewModel={card} />");
    expect(detailPageSource).toMatch(
      /@media \(min-width: 1024px\)[\s\S]*grid-template-columns:\s*320px 1fr/,
    );
    expect(detailPageSource).toContain("VIEW LIVE RESULTS");
  });

  it("keeps the created outcome first and places the desktop grid deterministically", () => {
    expect(detailPageSource).toMatch(
      /<main[\s\S]*?data-creator-surface\s*>\s*\{created && \(/,
    );
    expect(detailPageSource).toContain('data-outcome="created"');
    expect(detailPageSource).toContain(
      ".has-created-outcome > .creator-list-region",
    );
    expect(detailPageSource).toContain(
      ".has-created-outcome > .creator-detail-region",
    );
  });

  it("keeps the create target accessible and detail copy within measure", () => {
    expect(detailPageSource).toMatch(
      /\.list-create-link\s*{[\s\S]*?display:\s*inline-flex;[\s\S]*?min-height:\s*44px;/,
    );
    expect(detailPageSource).toMatch(
      /\.creator-detail-region\s*{[\s\S]*?max-width:\s*var\(--space-measure\);/,
    );
  });

  it("uses semantic lists while leaving each row as the only target", () => {
    for (const source of [creatorPageSource, detailPageSource]) {
      expect(source).toMatch(
        /<ul\b[^>]*class="poll-list"[\s\S]*<li>[\s\S]*<PollCard/,
      );
    }
    expect(cardSource.match(/<a\b/g)).toHaveLength(1);
  });

  it("wires detail status and excludes later-story controls", () => {
    expect(detailPageSource).toContain(
      '<p class="detail-status" data-detail-status>',
    );
    expect(detailPageSource).toContain(
      "<LiveIndicator status={detailStatus}>",
    );
    expect(detailPageSource).toContain("{formatVoteTotal(voterCount)}");

    for (const outOfScope of [
      "share-action",
      "ShareAction",
      "data-overlay",
      "<dialog",
      "security-toggle",
      "chart-form-toggle",
    ]) {
      expect(detailPageSource).not.toContain(outOfScope);
    }
  });

  it("builds each row once in the component-adjacent presenter", () => {
    expect(
      creatorPageSource.match(/buildPollCardViewModel\(/g),
    ).toHaveLength(1);
    expect(
      detailPageSource.match(/buildPollCardViewModel\(/g),
    ).toHaveLength(1);
    expect(creatorPageSource).not.toContain("pollCardMetaLine");
    expect(creatorPageSource).not.toContain("pollCardMetaParts");
    expect(detailPageSource).not.toContain("pollCardMetaLine");
    expect(detailPageSource).not.toContain("pollCardMetaParts");
  });

  it("keeps private no-store cache control on the dashboard", () => {
    expect(creatorPageSource).toContain(
      'cache-control", "private, no-store"',
    );
    expect(creatorPageSource).toContain("No Polls yet.");
    expect(creatorPageSource).toContain("CREATE A POLL");
  });
});
