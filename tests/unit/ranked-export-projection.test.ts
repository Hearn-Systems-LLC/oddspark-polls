import { describe, expect, it } from "vitest";
import { rankedChoiceStrategy } from "../../src/modules/polls/types/ranked-choice";

describe("rankedChoiceStrategy.projectExport", () => {
  const validFacts = {
    options: [
      { label: "Alpha", position: 0, count: 2 },
      { label: "Beta", position: 1, count: 1 },
    ],
    votes: [
      { alignmentKey: 0, createdAtMs: 1000, rankedOptionPositions: [0, 1] },
      { alignmentKey: 1, createdAtMs: 2000, rankedOptionPositions: [1, 0] },
      { alignmentKey: 2, createdAtMs: 3000, rankedOptionPositions: [0] },
    ],
    voterCount: 3,
    selectionCount: 5,
  };

  it("produces a valid projection with rank columns", () => {
    const result = rankedChoiceStrategy.projectExport(validFacts);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.votes.columns).toEqual(["RANK 1", "RANK 2"]);
    expect(result.value.votes.rows).toHaveLength(3);
    expect(result.value.votes.rows[0].cells).toEqual(["Alpha", "Beta"]);
    expect(result.value.votes.rows[1].cells).toEqual(["Beta", "Alpha"]);
    expect(result.value.votes.rows[2].cells).toEqual(["Alpha", ""]);
    expect(result.value.tally.columns).toEqual(["OPTION", "COUNT"]);
    expect(result.value.tally.rows).toEqual([
      ["Alpha", 2],
      ["Beta", 1],
    ]);
  });

  it("fails closed when voterCount does not match votes length", () => {
    const result = rankedChoiceStrategy.projectExport({
      ...validFacts,
      voterCount: 99,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("export_projection_invalid");
    }
  });

  it("fails closed when selectionCount does not match total preferences", () => {
    const result = rankedChoiceStrategy.projectExport({
      ...validFacts,
      selectionCount: 99,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("export_projection_invalid");
    }
  });

  it("fails closed when alignment keys are not sequential", () => {
    const result = rankedChoiceStrategy.projectExport({
      ...validFacts,
      votes: [
        { alignmentKey: 0, createdAtMs: 1000, rankedOptionPositions: [0] },
        { alignmentKey: 5, createdAtMs: 2000, rankedOptionPositions: [1] },
        { alignmentKey: 2, createdAtMs: 3000, rankedOptionPositions: [0] },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed when vote timestamps are out of order", () => {
    const result = rankedChoiceStrategy.projectExport({
      ...validFacts,
      votes: [
        { alignmentKey: 0, createdAtMs: 3000, rankedOptionPositions: [0] },
        { alignmentKey: 1, createdAtMs: 1000, rankedOptionPositions: [1] },
        { alignmentKey: 2, createdAtMs: 2000, rankedOptionPositions: [0] },
      ],
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed with duplicate option positions in a single ballot", () => {
    const result = rankedChoiceStrategy.projectExport({
      ...validFacts,
      votes: [
        { alignmentKey: 0, createdAtMs: 1000, rankedOptionPositions: [0, 0] },
        { alignmentKey: 1, createdAtMs: 2000, rankedOptionPositions: [1] },
        { alignmentKey: 2, createdAtMs: 3000, rankedOptionPositions: [0] },
      ],
      selectionCount: 4,
    });
    expect(result.ok).toBe(false);
  });

  it("fails closed with fewer than 2 options", () => {
    const result = rankedChoiceStrategy.projectExport({
      options: [{ label: "Alpha", position: 0, count: 1 }],
      votes: [
        { alignmentKey: 0, createdAtMs: 1000, rankedOptionPositions: [0] },
      ],
      voterCount: 1,
      selectionCount: 1,
    });
    expect(result.ok).toBe(false);
  });
});
