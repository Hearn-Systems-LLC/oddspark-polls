import { describe, expect, it, vi } from "vitest";
import { resolveAuthorizedBallotLabels } from "../../src/modules/results/post-vote";

describe("resolveAuthorizedBallotLabels", () => {
  it.each([
    "after_close_hidden",
    "creator_only_hidden",
    "unavailable",
    "not_found",
  ] as const)(
    "does not read claim selections for a %s Results outcome",
    async (kind) => {
      const findVoteSelectionByClaim = vi.fn(async () => ["Alpha"]);

      await expect(
        resolveAuthorizedBallotLabels(
          { kind },
          "voter-token",
          findVoteSelectionByClaim,
        ),
      ).resolves.toEqual([]);
      expect(findVoteSelectionByClaim).not.toHaveBeenCalled();
    },
  );

  it("reads claim selections only after a visible Results outcome", async () => {
    const findVoteSelectionByClaim = vi.fn(async () => ["Alpha", "Beta"]);

    await expect(
      resolveAuthorizedBallotLabels(
        { kind: "visible" },
        "voter-token",
        findVoteSelectionByClaim,
      ),
    ).resolves.toEqual(["Alpha", "Beta"]);
    expect(findVoteSelectionByClaim).toHaveBeenCalledOnce();
    expect(findVoteSelectionByClaim).toHaveBeenCalledWith("voter-token");
  });

  it("does not read claim selections without a voter token", async () => {
    const findVoteSelectionByClaim = vi.fn(async () => ["Alpha"]);

    await expect(
      resolveAuthorizedBallotLabels(
        { kind: "visible" },
        null,
        findVoteSelectionByClaim,
      ),
    ).resolves.toEqual([]);
    expect(findVoteSelectionByClaim).not.toHaveBeenCalled();
  });

  it("keeps the visible Tally when the claim-selection lookup fails", async () => {
    const findVoteSelectionByClaim = vi.fn(async () => {
      throw new Error("D1 unavailable");
    });

    await expect(
      resolveAuthorizedBallotLabels(
        { kind: "visible" },
        "voter-token",
        findVoteSelectionByClaim,
      ),
    ).resolves.toEqual([]);
    expect(findVoteSelectionByClaim).toHaveBeenCalledOnce();
  });
});
