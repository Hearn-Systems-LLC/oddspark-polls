import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync("src/components/security-toggle.astro", "utf8");
const tokensSource = readFileSync("src/styles/tokens.css", "utf8");

describe("security-toggle component contract (Story 2.1)", () => {
  it("binds to security-toggle tokens without opacity or raw hex", () => {
    expect(tokensSource).toContain("--security-toggle-track-width: 40px");
    expect(tokensSource).toContain("--security-toggle-track-height: 20px");
    expect(tokensSource).toContain("--security-toggle-knob-size: 16px");
    expect(tokensSource).toContain("--security-toggle-radius: 0");
    expect(tokensSource).toContain(
      "--security-toggle-track-on: var(--color-solar-wash)",
    );
    expect(tokensSource).toContain(
      "--security-toggle-knob-locked: var(--color-dim)",
    );
    expect(tokensSource).toContain("--color-solar-dark:");

    expect(componentSource).toContain("var(--security-toggle-track-width)");
    expect(componentSource).toContain("var(--security-toggle-knob-locked)");
    expect(componentSource).toContain(
      ".security-toggle.is-locked .security-toggle-track .security-toggle-knob",
    );
    expect(componentSource).toContain("var(--focus-outline)");
    expect(componentSource).not.toMatch(/opacity\s*:/i);
    expect(componentSource).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(componentSource).not.toContain("set:html");
    expect(componentSource).not.toContain('role="switch"');
    expect(componentSource).not.toMatch(/(?:^|[^-])transition\s*:/m);
  });

  it("uses a native checkbox and a hidden input for locked-on round-trip", () => {
    expect(componentSource).toContain('type="checkbox"');
    expect(componentSource).toContain("visually-hidden");
    expect(componentSource).toContain("needsHidden");
    expect(componentSource).toContain("type=\"hidden\"");
    expect(componentSource).toContain("LOCKED");
  });
});
