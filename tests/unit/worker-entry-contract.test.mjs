import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseJsonc } from "../../scripts/deploy-config.mjs";

const wrangler = parseJsonc(
  readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8"),
);

describe("Worker entry and Cron Trigger contract", () => {
  it("uses the application Worker wrapper as the entrypoint", () => {
    expect(wrangler.main).toBe("src/worker.ts");
  });

  it("configures the 15-minute cleanup cron in every environment", () => {
    for (const scope of [
      wrangler,
      wrangler.env.staging,
      wrangler.env.production,
    ]) {
      expect(scope.triggers?.crons).toEqual(["*/15 * * * *"]);
    }
  });
});
