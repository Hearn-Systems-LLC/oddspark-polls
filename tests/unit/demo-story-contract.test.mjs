import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const architecture = readFileSync(
  "_bmad-output/planning-artifacts/architecture/architecture-oddspark-polls-2026-07-29/ARCHITECTURE-SPINE.md",
  "utf8",
);
const epics = readFileSync("_bmad-output/planning-artifacts/epics.md", "utf8");
const design = readFileSync(
  "_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/DESIGN.md",
  "utf8",
);
const experience = readFileSync(
  "_bmad-output/planning-artifacts/ux-designs/ux-oddspark-polls-2026-07-28/EXPERIENCE.md",
  "utf8",
);
const architectureCompact = architecture.replace(/\s+/g, " ");

describe("Demo Poll source-of-truth contracts (Story 3.5)", () => {
  it("ratifies ResetDemoPoll as the single aggregate-replacement coordinator", () => {
    expect(architecture).toContain("`ResetDemoPoll`");
    expect(architectureCompact).toContain(
      "accepted Vote facts remain immutable while their Poll aggregate exists",
    );
    expect(architectureCompact).toContain("stable canonical reference");
    expect(architectureCompact).toContain("stable option IDs");
    expect(architectureCompact).toContain("transaction-current version plus one");
    expect(architectureCompact).toContain(
      "conditional duplicate-reference assertion",
    );
    expect(architectureCompact).toContain("no moderation history");
    expect(architectureCompact).toContain("demo-reset-flash");
    expect(architectureCompact).toContain("Vote/reset and Delist/reset races");
  });

  it("assigns the Demo policy, coordinator, adapter, and routes explicitly", () => {
    expect(architecture).toContain("FR-26, CAP-DEMO-POLL");
    expect(architecture).toContain("`polls/demo-poll` owns designation");
    expect(architecture).toContain("D1 Demo replacement adapter");
    expect(architecture).toContain("landing and creator Poll detail routes");
    expect(architecture).toContain("No migration is required");
  });

  it("narrows the embedded editable Tally to entropy leadership and one badge", () => {
    for (const source of [epics, design, experience]) {
      expect(source).toContain("embedded editable Demo");
      expect(source).toContain("entropy wash/edge");
      expect(source).toContain("exactly one trust badge");
      expect(source).toContain("canonical gold leadership");
    }
  });

  it("makes reset the fourth confirmation with the complete baseline", () => {
    expect(epics).toContain("exactly four");
    expect(design).toMatch(/exactly four/i);
    expect(experience).toContain("four confirmations and panels");
    for (const source of [epics, design, experience]) {
      expect(source).toContain("RESET DEMO POLL?");
      expect(source).toContain("KEEP VOTES");
      expect(source).toContain("RESET VOTES");
      expect(source).toContain("RESETTING…");
    }
  });

  it("pins Demo outcome order, unavailable, live-before-vote, and no-script states", () => {
    for (const source of [epics, experience]) {
      expect(source).toContain("complete Demo region first inside `<main>`");
      expect(source).toContain("Friday`, `Monday`, `Either works");
      expect(source).toContain("live Tally before a Vote");
      expect(source).toContain("DEMO UNAVAILABLE");
      expect(source).toContain(
        "JavaScript is required for the human check on this Poll.",
      );
    }
  });
});
