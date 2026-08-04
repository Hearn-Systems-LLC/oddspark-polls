import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/index.astro", "utf8");
const openingCopy =
  "Oddspark Polls is where a casual question gets an honest answer — multiple-choice, ranked, image, and meeting polls, with vote security and no subscription wall.";
const buildAccountCopy =
  "Runs on Cloudflare Workers, server-rendered by Astro. Polls and votes live in D1; images live in R2. Sign-in is Better Auth with Google or GitHub. Turnstile checks the vote; rate limiting checks the rush. The code is public — see the repository.";

function dataElement(attribute) {
  const match = source.match(
    new RegExp(
      `<([a-z][\\w-]*)[^>]*\\b${attribute}\\b[^>]*>([\\s\\S]*?)<\\/\\1>`,
    ),
  );
  expect(match, `expected an element carrying ${attribute}`).not.toBeNull();
  return match?.[2] ?? "";
}

function visibleText(fragment) {
  return fragment
    .replace(/<[^>]+>/g, " ")
    .replace(/\{[^}]+\}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("landing page source contract", () => {
  it("keeps the plain-language opening exact and free of stack vocabulary", () => {
    const opening = visibleText(dataElement("data-landing-statement"));
    expect(opening).toBe(openingCopy);
    expect(opening).not.toMatch(
      /\b(?:Workers|D1|R2|Turnstile|Better Auth|Astro|OAuth|server|deploy)\b/i,
    );
  });

  it("keeps the exact technical account separate and names the complete stack", () => {
    const buildAccount = visibleText(dataElement("data-landing-build-account"));
    expect(buildAccount).toContain(buildAccountCopy);
    for (const technology of [
      "Workers",
      "D1",
      "R2",
      "Turnstile",
      "Better Auth",
    ]) {
      expect(buildAccount).toContain(technology);
    }
  });

  it("preserves the token-derived deploy smoke marker", () => {
    expect(source).toContain(
      'import tokensCss from "../styles/tokens.css?raw"',
    );
    expect(source).toContain("/--color-solar-dark:\\s*(#[0-9a-fA-F]{3,8})\\s*;/");
    expect(source).toContain(
      'throw new Error("tokens.css: --color-solar-dark not found")',
    );
    expect(source).toContain(
      'data-smoke-marker="oddspark-token-solar"',
    );
    expect(source).toContain("data-token-solar={solarHex}");
    expect(source).toContain("smoke · solar · {solarHex}");
  });

  it("links only the repository, create entry, and Discover in canonical order", () => {
    const hrefs = [...source.matchAll(/\bhref="([^"]+)"/g)].map(
      (match) => match[1],
    );
    expect(hrefs).toEqual([
      "https://github.com/Hearn-Systems-LLC/oddspark-polls",
      "/creator/new",
      "/discover",
    ]);
  });

  it("uses the anchor form of ButtonPrimary as the only primary action", () => {
    expect(source.match(/<ButtonPrimary\b/g) ?? []).toHaveLength(1);
    expect(source).toMatch(/<ButtonPrimary\s+href="\/creator\/new">/);
    expect(source).not.toMatch(/<button[^>]*class="[^"]*btn-primary/);
  });

  it("keeps indexable token-only markup without inline presentation", () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\bnoindex\b/i);
    expect(source).not.toMatch(/\sstyle=/i);
  });
});
