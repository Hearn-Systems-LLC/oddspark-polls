import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const README_PATH = "README.md";
const ARCHITECTURE_PATH =
  "_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md";
const REPOSITORY_URL =
  "https://github.com/Hearn-Systems-LLC/oddspark-polls";
const readme = readFileSync(README_PATH, "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const repositoryComponent = readFileSync(
  "src/components/public-repository-link.astro",
  "utf8",
);
const landingIntro = readFileSync(
  "src/components/landing-intro.astro",
  "utf8",
);
const votingSurface = readFileSync(
  "src/components/poll-voting-surface.astro",
  "utf8",
);
const resultsPage = readFileSync(
  "src/pages/[reference]/results.astro",
  "utf8",
);

describe("public repository contract", () => {
  it("links the evaluator guide to the tracked architecture spine", () => {
    expect(readme).toContain(`](${ARCHITECTURE_PATH})`);
    expect(existsSync(ARCHITECTURE_PATH)).toBe(true);
    const tracked = execFileSync(
      "git",
      ["ls-files", "--error-unmatch", ARCHITECTURE_PATH],
      { encoding: "utf8" },
    ).trim();
    expect(tracked).toBe(ARCHITECTURE_PATH);
  });

  it("documents the tour, fresh-clone run path, and complete local gate", () => {
    const required = [
      "## Product tour",
      "pnpm install",
      "./scripts/provision-auth-secrets.zsh local initialize",
      "pnpm migrate:local",
      "pnpm dev",
      "pnpm migrations:guard",
      "pnpm test",
      "pnpm check",
      "pnpm test:e2e",
      "pnpm types",
      "git diff --exit-code worker-configuration.d.ts",
      "pnpm build:production",
      "git diff --check",
    ];
    for (const requiredText of required) {
      expect(readme).toContain(requiredText);
    }

    const gateSection = readme.slice(
      readme.indexOf("## Local verification gate"),
      readme.indexOf("## Release and deploy gate"),
    );
    const gateCommands = required.slice(5);
    const gatePositions = gateCommands.map((command) => gateSection.indexOf(command));
    expect(gatePositions.every((position) => position >= 0)).toBe(true);
    expect(gatePositions).toEqual([...gatePositions].sort((left, right) => left - right));
  });

  it("keeps package and every rendered repository entry on one presentation seam", () => {
    expect(packageJson.repository).toEqual({
      type: "git",
      url: `${REPOSITORY_URL}.git`,
    });
    expect(packageJson.homepage).toBe(REPOSITORY_URL);
    expect(repositoryComponent).toContain(REPOSITORY_URL);
    expect(repositoryComponent.match(new RegExp(REPOSITORY_URL, "g"))).toHaveLength(1);
    expect(landingIntro).toContain("<PublicRepositoryLink surface=\"landing\" />");
    expect(landingIntro).not.toContain(REPOSITORY_URL);
    expect(votingSurface).toContain("!embedded && <PublicRepositoryLink />");
    expect(resultsPage).toContain("<PublicRepositoryLink />");

    const componentConsumers = execFileSync(
      "git",
      ["grep", "-l", "PublicRepositoryLink", "--", "src/**/*.astro"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .sort();
    expect(componentConsumers).toEqual([
      "src/components/landing-intro.astro",
      "src/components/poll-voting-surface.astro",
      "src/pages/[reference]/manifest.astro",
      "src/pages/[reference]/results.astro",
    ]);

    const hardCodedAstroSources = execFileSync(
      "git",
      ["grep", "-l", "-F", REPOSITORY_URL, "--", "src/**/*.astro"],
      { encoding: "utf8" },
    )
      .trim()
      .split("\n");
    expect(hardCodedAstroSources).toEqual([
      "src/components/public-repository-link.astro",
    ]);
  });

  it("keeps scanner output and temporary audit artifacts out of tracked paths", () => {
    const trackedPaths = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean);
    expect(trackedPaths).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /(?:^|\/)(?:\.?gitleaks|secret[-_.]?scan|history[-_.]?audit|security[-_.]?audit|audit|scan|reports?)(?:\/|[-_.].*)[^/]*\.(?:json|sarif|csv|log|txt)$/iu,
        ),
      ]),
    );
  });
});
