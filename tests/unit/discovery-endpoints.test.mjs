import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("discovery endpoint method contracts", () => {
  it.each([
    ["sitemap.xml", "src/pages/sitemap.xml.ts"],
    ["robots.txt", "src/pages/robots.txt.ts"],
  ])("keeps %s HEAD on the one GET implementation", (_name, path) => {
    const source = fs.readFileSync(path, "utf8");
    expect(source).toMatch(/export const GET/);
    expect(source).toMatch(/export const ALL/);
    expect(source).not.toMatch(/export const HEAD/);
  });

  it("keeps sitemap enumeration in the Discovery application service", () => {
    const source = fs.readFileSync("src/pages/sitemap.xml.ts", "utf8");
    expect(source).toContain("buildDiscoverySitemap");
    expect(source).toContain("parseDiscoverySitemapRequest");
    expect(source).toContain("AbortSignal.any");
    expect(source).toContain("request.signal");
    expect(source).toContain("AbortSignal.timeout(SITEMAP_BUILD_BUDGET_MS)");
    expect(source).toContain("deadlineAtMs");
    expect(source).toContain("sitemap_range_gone");
    expect(source).not.toMatch(/SELECT\s|FROM\s+poll|discovery_state/i);
  });
});
