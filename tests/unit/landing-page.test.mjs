import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/index.astro", "utf8");
const introSource = readFileSync("src/components/landing-intro.astro", "utf8");
const footerSource = readFileSync("src/components/landing-footer.astro", "utf8");
const repositoryLinkSource = readFileSync(
  "src/components/public-repository-link.astro",
  "utf8",
);
const votingSurfaceSource = readFileSync(
  "src/components/poll-voting-surface.astro",
  "utf8",
);
const openingCopy =
  "Oddspark Polls is where a casual question gets an honest answer — multiple-choice, ranked, image, and meeting polls, with vote security and no subscription wall.";
const buildAccountCopy =
  "Runs on Cloudflare Workers, server-rendered by Astro. Polls and votes live in D1; images live in R2. Sign-in is Better Auth with Google or GitHub. Turnstile checks the vote; rate limiting checks the rush. The code is public.";

function dataElement(attribute) {
  const match = introSource.match(
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
    const buildAccount = visibleText(dataElement("data-landing-build-copy"));
    expect(buildAccount).toBe(buildAccountCopy);
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

  it("ends the build account at the public-code fact with no trailing repository pointer", () => {
    const buildAccount = visibleText(dataElement("data-landing-build-copy"));
    expect(buildAccount.endsWith("The code is public.")).toBe(true);
    expect(introSource).not.toContain("see the repository");
    expect(introSource).not.toContain("PublicRepositoryLink");
  });

  it("preserves the token-derived deploy smoke marker", () => {
    expect(source).toContain(
      'import tokensCss from "../styles/tokens.css?raw"',
    );
    expect(source).toContain("/--color-solar-dark:\\s*(#[0-9a-fA-F]{3,8})\\s*;/");
    expect(source).toContain(
      'throw new Error("tokens.css: --color-solar-dark not found")',
    );
    expect(introSource).toContain(
      'data-smoke-marker="oddspark-token-solar"',
    );
    expect(introSource).toMatch(
      /<p\s+class="label-caps"\s+data-smoke-marker="oddspark-token-solar"/,
    );
    expect(introSource).toContain("data-token-solar={solarHex}");
    expect(introSource).toContain("smoke · solar · {solarHex}");
  });

  it("keeps repository, unavailable retry, create, and Discover destinations explicit", () => {
    expect(repositoryLinkSource).toContain(
      "https://github.com/Hearn-Systems-LLC/oddspark-polls",
    );
    expect(footerSource).toContain('<PublicRepositoryLink surface="landing" />');
    expect(source).toContain('href="/">{DEMO_POLL_COPY.retry}</a>');
    expect(footerSource).toContain('href="/creator/new"');
    expect(footerSource).toContain('href="/discover"');
  });

  it("retires the orphaned Create and Browse blocks from the main grid", () => {
    expect(source).not.toContain("landing-create-label");
    expect(source).not.toContain("landing-discover-label");
    expect(source).not.toContain("landing-block, .rule");
    expect(source).toContain("<LandingFooter");
    expect(source.indexOf("</main>")).toBeLessThan(
      source.indexOf("<LandingFooter"),
    );
  });

  it("renders one footer landmark with the byline link and the landing nav in order", () => {
    expect(footerSource).toContain("<footer");
    expect(footerSource).toContain('aria-label="Landing"');
    expect(footerSource).toContain('href="https://hearn.systems"');
    expect(footerSource).toContain('rel="noopener"');
    // The trailing space in "built by " keeps the computed accessible name
    // "built by Hearn." — without it the name concatenates.
    expect(footerSource).toMatch(/built by <svg/);
    expect(footerSource).toContain('role="img"');
    expect(footerSource).toContain('aria-label="Hearn."');
    expect(footerSource).toContain('fill="currentColor"');
    const createAt = footerSource.indexOf('href="/creator/new"');
    const discoverAt = footerSource.indexOf('href="/discover"');
    const repositoryAt = footerSource.indexOf("<PublicRepositoryLink");
    expect(createAt).toBeGreaterThan(-1);
    expect(createAt).toBeLessThan(discoverAt);
    expect(discoverAt).toBeLessThan(repositoryAt);
    // The byline is attribution, not navigation, and stays out of the nav.
    expect(footerSource.indexOf('href="https://hearn.systems"')).toBeLessThan(
      footerSource.indexOf("<nav"),
    );
  });

  it("reserves the sole primary action for VOTE and demotes Create", () => {
    expect(votingSurfaceSource.match(/<ButtonPrimary\b/g) ?? []).toHaveLength(1);
    expect(votingSurfaceSource).toContain(">VOTE</ButtonPrimary>");
    expect(source).not.toContain("ButtonPrimary");
    expect(footerSource).toContain(
      'class="label-caps landing-footer-link" href="/creator/new"',
    );
    expect(footerSource).not.toMatch(/<button[^>]*class="[^"]*btn-primary/);
  });

  it("keeps indexable token-only markup without inline presentation", () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\bnoindex\b/i);
    expect(source).not.toMatch(/\sstyle=/i);
  });
});
