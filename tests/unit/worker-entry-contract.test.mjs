import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wrangler = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");

describe("Worker entry and Cron Trigger contract", () => {
  it("uses the application Worker wrapper as the entrypoint", () => {
    expect(wrangler).toContain('"main": "src/worker.ts"');
  });

  it("configures the 15-minute cleanup cron in every environment", () => {
    expect(wrangler.match(/"crons": \["\*\/15 \* \* \* \*"\]/g)).toHaveLength(3);
  });
});
