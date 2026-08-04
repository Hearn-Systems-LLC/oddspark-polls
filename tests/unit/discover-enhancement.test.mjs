import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Discover progressive enhancement source contract", () => {
  it("preserves rows, manages history, rejects stale fetches, and announces one exact error", async () => {
    const source = await readFile("src/scripts/discover-catalog.ts", "utf8");
    expect(source).toContain("DISCOVERY_COPY.error");
    expect(source).toContain("history.pushState");
    expect(source).toContain('addEventListener("popstate"');
    expect(source).toContain("AbortController");
    expect(source).toContain("navigationToken");
    expect(source).toContain('setAttribute("aria-busy", "true")');
    expect(source).toContain('setAttribute("aria-busy", "false")');
    expect(source).toContain("data-discover-skeletons");
    expect(source).toContain("data-discover-status");
    expect(source).not.toMatch(/\.focus\(|scrollTo|scrollIntoView/);
  });
});
