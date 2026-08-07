import { describe, expect, it } from "vitest";
import { rankSummary, toggleRankedPreference } from "../../src/modules/voting/rank-draft";
import type { PollOptionId } from "../../src/shared/domain/index";

const option = (value: string): PollOptionId => value as PollOptionId;

describe("ranked ballot draft", () => {
  it("assigns each unranked option the next contiguous rank", () => {
    const first = toggleRankedPreference([], option("pizza"));
    expect(toggleRankedPreference(first, option("tacos"))).toEqual([
      { optionId: "pizza", rank: 1 },
      { optionId: "tacos", rank: 2 },
    ]);
  });

  it("unranks an option and compacts every later preference", () => {
    expect(
      toggleRankedPreference(
        [
          { optionId: option("pizza"), rank: 1 },
          { optionId: option("tacos"), rank: 2 },
          { optionId: option("ramen"), rank: 3 },
        ],
        option("tacos"),
      ),
    ).toEqual([
      { optionId: "pizza", rank: 1 },
      { optionId: "ramen", rank: 2 },
    ]);
  });

  it("formats the exact accessibility summary", () => {
    expect(rankSummary(2, 4)).toBe(
      "RANKED 2 OF 4 · UNRANKED OPTIONS COUNT AS NO PREFERENCE",
    );
  });
});
