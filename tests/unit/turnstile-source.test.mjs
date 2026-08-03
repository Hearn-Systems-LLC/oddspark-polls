import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ALWAYS_PASS_SITE_KEY = "1x00000000000000000000AA";
const DUMMY_SECRET = "1x0000000000000000000000000000000AA";

describe("Turnstile source contracts", () => {
  it("keeps the dummy secret out of application source and dummy site key out of remote vars", () => {
    const wrangler = readFileSync("wrangler.jsonc", "utf8");
    expect(wrangler).toContain(ALWAYS_PASS_SITE_KEY);
    const stagingBlock = wrangler.slice(
      wrangler.indexOf('"staging"'),
      wrangler.indexOf('"production"'),
    );
    const productionBlock = wrangler.slice(wrangler.indexOf('"production"'));
    expect(stagingBlock).not.toContain(ALWAYS_PASS_SITE_KEY);
    expect(productionBlock).not.toContain(ALWAYS_PASS_SITE_KEY);
    expect(stagingBlock).not.toContain(DUMMY_SECRET);
    expect(productionBlock).not.toContain(DUMMY_SECRET);

    const adapter = readFileSync("src/adapters/turnstile/index.ts", "utf8");
    expect(adapter).not.toContain(DUMMY_SECRET);
    expect(adapter).toContain(ALWAYS_PASS_SITE_KEY);

    const requiredSecrets = [
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_URL",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
      "TURNSTILE_SECRET_KEY",
      "VOTE_DIGEST_SECRET",
    ];
    for (const level of ["root", "staging", "production"]) {
      const block =
        level === "root"
          ? wrangler.slice(0, wrangler.indexOf('"env"'))
          : level === "staging"
            ? stagingBlock
            : productionBlock;
      for (const name of requiredSecrets) {
        expect(block).toContain(`"${name}"`);
      }
    }
  });
});
