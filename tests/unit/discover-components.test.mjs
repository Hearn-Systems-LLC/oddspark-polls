import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const discoverPath = "src/components/discover-catalog.astro";
const paginationPath = "src/components/pagination.astro";
const tokensPath = "src/styles/tokens.css";

describe("Discover component contracts", () => {
  it("composes unchanged PollCard rows as one semantic list and one anchor per Poll", async () => {
    const source = await readFile(discoverPath, "utf8");
    expect(source).toContain('import PollCard from "./poll-card.astro"');
    expect(source).toContain('import { buildPollCardViewModel } from "./poll-card"');
    expect(source).toContain("<h1>Discover</h1>");
    expect(source).toMatch(/<ul[^>]*data-discover-list/);
    expect(source).toContain("<li>");
    expect(source).toContain("<PollCard");
    expect(source).toContain('status: "open"');
    expect(source).toContain("voterCount: item.voteCount");
    expect(source).toContain("href: `/${encodeURIComponent(item.canonicalReference)}`");
    expect(source).not.toMatch(/\blisting\s*:/);
    expect(source).not.toContain("set:html");
    expect((source.match(/<a\b/g) ?? []).length).toBe(2); // retry + create only
  });

  it("renders exactly 20 inert static skeleton rows without motion", async () => {
    const source = await readFile(discoverPath, "utf8");
    expect(source).toContain("Array.from({ length: DISCOVERY_PAGE_SIZE })");
    expect(source).toContain('aria-hidden="true"');
    expect(source).toContain("data-discover-skeletons");
    expect(source).not.toMatch(/animation|transition|shimmer|pulse|spinner/i);
    expect(source).not.toMatch(/tabindex|opacity/i);
  });

  it("renders real 48px NEWER and OLDER links plus inert exhausted text", async () => {
    const source = await readFile(paginationPath, "utf8");
    expect(source).toContain('<nav aria-label="Discover pages"');
    expect(source).toContain("href={newerUrl}");
    expect(source).toContain("href={olderUrl}");
    expect(source).toContain('aria-disabled="true"');
    expect(source).toContain("var(--pagination-min-height)");
    expect(source).toContain("var(--pagination-focus-outline)");
    expect(source).toContain("var(--pagination-focus-outline-offset)");
    expect(source).not.toMatch(/button|onclick|tabindex/i);
  });

  it("binds pagination only to existing collapsed tokens", async () => {
    const source = await readFile(tokensPath, "utf8");
    const expected = [
      "--pagination-font: var(--font-machine);",
      "--pagination-size: var(--type-label-caps-size);",
      "--pagination-line-height: var(--type-label-caps-lh);",
      "--pagination-letter-spacing: var(--type-label-caps-ls);",
      "--pagination-color: var(--color-entropy);",
      "--pagination-color-disabled: var(--color-dim);",
      "--pagination-gap: var(--space-6);",
      "--pagination-min-height: 48px;",
      "--pagination-focus-outline: var(--focus-outline);",
      "--pagination-focus-outline-offset: var(--focus-outline-offset);",
    ];
    for (const binding of expected) expect(source).toContain(binding);
  });
});
