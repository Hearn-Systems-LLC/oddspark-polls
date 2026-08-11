import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const resultsPage = readFileSync(
  new URL("../../src/pages/[reference]/results.astro", import.meta.url),
  "utf8",
);
const votingSurface = readFileSync(
  new URL("../../src/components/poll-voting-surface.astro", import.meta.url),
  "utf8",
);
const creatorPage = readFileSync(
  new URL("../../src/pages/creator/polls/[pollId].astro", import.meta.url),
  "utf8",
);

describe("Meeting Results page wiring", () => {
  it("renders the shared availability tally on the public Results page", () => {
    expect(resultsPage).toContain('import AvailabilityTally from "../../components/availability-tally.astro"');
    expect(resultsPage).toContain('view.kind === "meeting_visible"');
    expect(resultsPage).toContain("meeting={view.meeting}");
    expect(resultsPage).toContain("toggles={view.securityToggles}");
    expect(resultsPage).toContain('src="../../scripts/availability-grid.ts"');
    expect(resultsPage).toContain('src="../../scripts/meeting-results-live.ts"');
  });

  it("keeps the editable Meeting form beside its authorized post-vote tally", () => {
    expect(votingSurface).toContain('postVoteResults?.kind === "meeting_visible"');
    expect(votingSurface).toContain("meeting={postVoteResults.meeting}");
    expect(votingSurface).toContain('src="../scripts/meeting-results-live.ts"');
    expect(votingSurface).toContain('src="../scripts/availability-grid.ts"');
  });

  it("live-enhances the fixed-zone Creator tally without device-zone rewriting", () => {
    expect(creatorPage).toContain('src="../../../scripts/meeting-results-live.ts"');
    expect(creatorPage).not.toContain('src="../../../scripts/availability-grid.ts"');
  });
});
