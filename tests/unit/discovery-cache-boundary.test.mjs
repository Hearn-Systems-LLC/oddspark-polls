import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const RESULT_SURFACES = [
  "src/modules/results/index.ts",
  "src/adapters/d1/index.ts",
  "src/pages/[reference]/results.astro",
  "src/pages/[reference]/results/live.ts",
];

describe("Discovery cache namespace boundary", () => {
  it("is never referenced by Results application or delivery surfaces", async () => {
    for (const path of RESULT_SURFACES) {
      const source = await readFile(path, "utf8");
      expect(source, path).not.toContain("oddspark-discovery-v1");
      expect(source, path).not.toContain("createDiscoveryCache");
    }
  });
});
