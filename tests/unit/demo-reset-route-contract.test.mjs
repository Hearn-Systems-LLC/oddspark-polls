import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("src/pages/creator/polls/[pollId].astro", "utf8");
const formParser = readFileSync("src/lib/creator-lifecycle-form.ts", "utf8");
const adapter = readFileSync("src/adapters/d1/demo-poll.ts", "utf8");
const flash = readFileSync("src/lib/demo-reset-flash.ts", "utf8");
const overlay = readFileSync("src/scripts/overlay.ts", "utf8");

describe("Demo reset route contract", () => {
  it("strictly admits reset-demo and rechecks the provider-free command", () => {
    expect(formParser).toContain('| "reset-demo"');
    expect(route).toContain('intent === "reset-demo"');
    expect(route).toContain("resetDemoPoll(");
    expect(route).toContain("configuredReference: env.DEMO_POLL_REFERENCE");
  });

  it("renders the exact progressive confirmation and disabled empty state", () => {
    for (const key of [
      "resetTrigger",
      "resetDisabled",
      "resetTitle",
      "resetBody",
      "resetCancel",
      "resetConfirm",
      "resetPending",
    ]) expect(route).toContain(`DEMO_POLL_COPY.${key}`);
    expect(route).toContain('?confirm=reset-demo`');
    expect(route).toContain("data-reset-demo-form");
    expect(overlay).toContain("form.dataset.pendingLabel");
    expect(overlay).toContain('submit.setAttribute("aria-disabled", "true")');
    expect(overlay).not.toContain("submit.disabled = true");
    expect(route).toContain("demo-reset-outcome-heading");
  });

  it("uses a session-bound purpose-separated causal flash without a success query", () => {
    expect(flash).toContain("oddspark-demo-reset-flash:v1");
    expect(route).toContain("principal.session.id");
    expect(route).toContain("DEMO_RESET_FLASH_COOKIE_NAME");
    expect(route).toContain("verifyDemoResetFlash(");
    expect(route).not.toContain("?outcome=demo-reset");
  });

  it("stages successor, option, reference, delete, then rollback assertion", () => {
    const successor = adapter.indexOf("INSERT INTO poll (");
    const options = adapter.indexOf("UPDATE poll_option");
    const reference = adapter.indexOf("UPDATE poll_reference");
    const oldDelete = adapter.indexOf("DELETE FROM poll");
    const assertion = adapter.indexOf("INSERT INTO poll_reference (", reference);
    expect(successor).toBeGreaterThan(-1);
    expect(options).toBeGreaterThan(successor);
    expect(reference).toBeGreaterThan(options);
    expect(oldDelete).toBeGreaterThan(reference);
    expect(assertion).toBeGreaterThan(oldDelete);
    expect(adapter).toContain("UNIQUE constraint failed: poll_reference\\.reference");
  });
});
