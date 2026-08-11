import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/scripts/meeting-results-live.ts", import.meta.url),
  "utf8",
);

describe("Meeting Results live client contract", () => {
  it("uses the shared cadence, validator, visibility, and capped-backoff policy", () => {
    expect(source).toContain("createResultsLiveState");
    expect(source).toContain("nextResultsPollDelayMs");
    expect(source).toContain("shouldPollResults");
    expect(source).toContain("shouldAdoptResultsValidator");
    expect(source).toContain('document.addEventListener("visibilitychange"');
    expect(source).toContain('window.addEventListener("offline"');
    expect(source).toContain('window.addEventListener("online"');
    expect(source).toContain("AbortController");
  });

  it("rebuilds safe DOM while preserving the rendered tally on failures", () => {
    expect(source).toContain("replaceChildren");
    expect(source).toContain("textContent");
    expect(source).not.toContain("innerHTML");
    expect(source).toContain("RECONNECTING");
    expect(source).toContain("data-meeting-tally-content");
  });

  it("does not reload a Creator tally for comments that surface does not render", () => {
    expect(source).toContain("region === null ||");
  });
});
