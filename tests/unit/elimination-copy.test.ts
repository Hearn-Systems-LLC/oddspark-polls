import { describe, expect, it } from "vitest";
import type { RankedEliminationView } from "../../src/modules/results/index";
import type { PollOptionId } from "../../src/shared/domain/index";

function eliminationStatement(elim: RankedEliminationView): string {
  const names = elim.labels.map((l) => (l.trim() ? l : "—"));
  switch (elim.reason) {
    case "fewest_votes":
      return `${names.join(", ")} had the fewest votes and was eliminated.`;
    case "safe_batch":
      return `${names.join(", ")} together held fewer votes than any remaining option and were eliminated as a group.`;
    case "backward_tie_break": {
      const round = elim.backwardTieBreakRound ?? "?";
      return `${names.join(", ")} were tied; the tie was broken by their counts in Round ${round}, where they had fewer votes.`;
    }
  }
}

describe("elimination copy mapping", () => {
  it("renders fewest_votes with a single option name", () => {
    const elim: RankedEliminationView = {
      optionIds: ["opt-1" as PollOptionId],
      labels: ["Alpha"],
      reason: "fewest_votes",
    };
    expect(eliminationStatement(elim)).toBe(
      "Alpha had the fewest votes and was eliminated.",
    );
  });

  it("renders safe_batch with multiple option names", () => {
    const elim: RankedEliminationView = {
      optionIds: ["opt-1" as PollOptionId, "opt-2" as PollOptionId],
      labels: ["Alpha", "Beta"],
      reason: "safe_batch",
    };
    expect(eliminationStatement(elim)).toBe(
      "Alpha, Beta together held fewer votes than any remaining option and were eliminated as a group.",
    );
  });

  it("renders backward_tie_break with the prior round number", () => {
    const elim: RankedEliminationView = {
      optionIds: ["opt-2" as PollOptionId],
      labels: ["Beta"],
      reason: "backward_tie_break",
      backwardTieBreakRound: 1,
    };
    expect(eliminationStatement(elim)).toBe(
      "Beta were tied; the tie was broken by their counts in Round 1, where they had fewer votes.",
    );
  });

  it("renders backward_tie_break without round number as ?", () => {
    const elim: RankedEliminationView = {
      optionIds: ["opt-2" as PollOptionId],
      labels: ["Beta"],
      reason: "backward_tie_break",
    };
    expect(eliminationStatement(elim)).toContain("Round ?");
  });

  it("renders blank labels as em-dash", () => {
    const elim: RankedEliminationView = {
      optionIds: ["opt-1" as PollOptionId],
      labels: ["  "],
      reason: "fewest_votes",
    };
    expect(eliminationStatement(elim)).toBe(
      "— had the fewest votes and was eliminated.",
    );
  });
});
