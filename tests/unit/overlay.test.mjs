import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const overlaySource = readFileSync("src/components/overlay.astro", "utf8");
const overlayScript = readFileSync("src/scripts/overlay.ts", "utf8");
const destructiveSource = readFileSync(
  "src/components/button-destructive.astro",
  "utf8",
);
const tokensSource = readFileSync("src/styles/tokens.css", "utf8");
const detailSource = readFileSync(
  "src/pages/creator/polls/[pollId].astro",
  "utf8",
);

describe("destructive button tokens (Story 1.12)", () => {
  it("defines the destructive family against alarm without renaming solar-dark", () => {
    expect(tokensSource).toContain(
      "--btn-destructive-color: var(--color-alarm)",
    );
    expect(tokensSource).toContain(
      "--btn-destructive-border: var(--space-hairline) solid var(--color-alarm)",
    );
    expect(tokensSource).toContain("--color-solar-dark:");
  });

  it("binds the component to destructive tokens and 48px height", () => {
    expect(destructiveSource).toContain("var(--btn-destructive-border)");
    expect(destructiveSource).toContain("var(--btn-destructive-color)");
    expect(destructiveSource).toContain("min-height: 48px");
    expect(destructiveSource).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(destructiveSource).not.toContain("set:html");
  });
});

describe("overlay component contract (Story 1.12)", () => {
  it("exposes labelling and open/dismiss hooks without raw HTML", () => {
    expect(overlaySource).toContain('role="dialog"');
    expect(overlaySource).toContain("aria-modal");
    expect(overlaySource).toContain("aria-labelledby");
    expect(overlaySource).toContain("aria-describedby");
    expect(overlaySource).toContain("data-overlay");
    expect(overlaySource).toContain("data-overlay-scrim");
    expect(overlaySource).toContain("data-overlay-panel");
    expect(overlaySource).toContain("var(--overlay-scrim)");
    expect(overlaySource).not.toContain("set:html");
  });

  it("enhancer traps focus, Esc, scrim, and restores the invoker", () => {
    expect(overlayScript).toContain("Escape");
    expect(overlayScript).toContain("Tab");
    expect(overlayScript).toContain("data-overlay-scrim");
    expect(overlayScript).toContain("document.body.style.overflow");
    expect(overlayScript).toContain("returnTo?.focus");
    expect(overlayScript).toContain("data-overlay-open-for");
  });

  it("uses button-destructive only inside the delete confirmation", () => {
    expect(detailSource).toContain("ButtonDestructive");
    expect(detailSource).toContain("delete-poll-overlay");
    // Invoker is secondary, not destructive.
    expect(detailSource).toMatch(
      /DELETE POLL[\s\S]*?ButtonDestructive[\s\S]*?DELETE POLL/,
    );
    const consumers = readdirSync("src", { recursive: true })
      .filter(
        (entry) =>
          typeof entry === "string" && /\.(?:astro|ts)$/u.test(entry),
      )
      .filter((entry) =>
        readFileSync(`src/${entry}`, "utf8").includes(
          "button-destructive.astro",
        ),
      );
    expect(consumers).toEqual(["pages/creator/polls/[pollId].astro"]);
  });
});
