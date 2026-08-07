import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { PollOptionId } from "../../src/shared/domain/index";
import {
  tabulateIrv,
  type IrvBallot,
  type IrvOptionSet,
  type IrvOutcome,
  type IrvRound,
  type TabulateIrvInput,
} from "../../src/modules/results/tabulate-irv";

const optionId = (n: number): PollOptionId => `opt-${n}` as PollOptionId;

const makeOptions = (count: number): IrvOptionSet[] =>
  Array.from({ length: count }, (_, i) => ({
    id: optionId(i),
    label: `Option ${i}`,
    position: i,
  }));

const ballot = (...prefs: number[]): IrvBallot => ({
  preferences: prefs.map((n) => optionId(n)),
});

/**
 * Arbitrary ranking over option indices (any order). When `allowPartial` is
 * true, length may be shorter than the option set so partial-rank paths enter
 * the generative surface.
 */
const arbitraryBallot = (optionCount: number, allowPartial = false) =>
  fc
    .uniqueArray(fc.integer({ min: 0, max: optionCount - 1 }), {
      minLength: 1,
      maxLength: allowPartial
        ? Math.max(1, Math.floor(optionCount / 2) + 1)
        : optionCount,
    })
    .map((indices) => ballot(...indices));

const arbitraryInput = (
  optionMin: number,
  optionMax: number,
  ballotMin: number,
  ballotMax: number,
  allowPartial = true,
) =>
  fc.integer({ min: optionMin, max: optionMax }).chain((optionCount) =>
    fc.record({
      options: fc.constant(makeOptions(optionCount)),
      ballots: fc.array(arbitraryBallot(optionCount, allowPartial), {
        minLength: ballotMin,
        maxLength: ballotMax,
      }),
    }),
  );

function countsEqual(
  a: ReadonlyMap<PollOptionId, number>,
  b: ReadonlyMap<PollOptionId, number>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [id, count] of a) {
    if (b.get(id) !== count) return false;
  }
  return true;
}

function roundsEqual(a: readonly IrvRound[], b: readonly IrvRound[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (left.roundNumber !== right.roundNumber) return false;
    if (left.exhaustedCount !== right.exhaustedCount) return false;
    if (left.activeBallotCount !== right.activeBallotCount) return false;
    if (!countsEqual(left.counts, right.counts)) return false;
    if (left.eliminated === null && right.eliminated === null) continue;
    if (left.eliminated === null || right.eliminated === null) return false;
    if (left.eliminated.reason !== right.eliminated.reason) return false;
    if (
      left.eliminated.optionIds.length !== right.eliminated.optionIds.length
    ) {
      return false;
    }
    for (let j = 0; j < left.eliminated.optionIds.length; j++) {
      if (left.eliminated.optionIds[j] !== right.eliminated.optionIds[j]) {
        return false;
      }
    }
  }
  return true;
}

function outcomesEqual(a: IrvOutcome, b: IrvOutcome): boolean {
  if (a.resolved !== b.resolved) return false;
  if (!roundsEqual(a.rounds, b.rounds)) return false;
  if (a.resolved && b.resolved) {
    return a.winnerId === b.winnerId && a.winnerLabel === b.winnerLabel;
  }
  if (!a.resolved && !b.resolved) {
    if (a.tiedOptionIds.length !== b.tiedOptionIds.length) return false;
    for (let i = 0; i < a.tiedOptionIds.length; i++) {
      if (a.tiedOptionIds[i] !== b.tiedOptionIds[i]) return false;
      if (a.tiedOptionLabels[i] !== b.tiedOptionLabels[i]) return false;
    }
    return countsEqual(a.standingCounts, b.standingCounts);
  }
  return false;
}

function sumCounts(counts: ReadonlyMap<PollOptionId, number>): number {
  let total = 0;
  for (const count of counts.values()) {
    total += count;
  }
  return total;
}

describe("tabulateIrv", () => {
  describe("strict majority termination", () => {
    it("declares a winner when one option holds more than 50% of active ballots", () => {
      const options = makeOptions(3);
      const ballots: IrvBallot[] = [
        ballot(0, 1, 2),
        ballot(0, 1, 2),
        ballot(0, 2, 1),
        ballot(1, 0, 2),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.winnerId).toBe(optionId(0));
        expect(result.rounds.length).toBe(1);
        expect(result.rounds[0].eliminated).toBeNull();
        expect(result.rounds[0].counts.get(optionId(0))).toBe(3);
      }
    });

    it("transfers votes through elimination rounds until majority", () => {
      // R1: A=2, B=1, C=2 → eliminate B (fewest). B transfers to C.
      // R2: A=2, C=3 → C majority.
      const options = makeOptions(3);
      const ballots: IrvBallot[] = [
        ballot(0, 1, 2),
        ballot(0, 1, 2),
        ballot(1, 2, 0),
        ballot(2, 1, 0),
        ballot(2, 1, 0),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.winnerId).toBe(optionId(2));
        expect(result.rounds.length).toBe(2);
        expect(result.rounds[0].eliminated).toEqual({
          optionIds: [optionId(1)],
          reason: "fewest_votes",
        });
        expect(result.rounds[1].eliminated).toBeNull();
        expect(result.rounds[1].counts.get(optionId(2))).toBe(3);
        expect(result.rounds[1].counts.get(optionId(0))).toBe(2);
      }
    });
  });

  describe("safe batch elimination", () => {
    it("batch-eliminates tied-last group when combined votes < next-lowest", () => {
      // A=5, B=3, C=1, D=1 (total 10). No majority (need >5).
      // Tied last C+D combined 2 < B=3 → safe_batch.
      const options = makeOptions(4);
      const ballots: IrvBallot[] = [
        ballot(0, 1, 2, 3),
        ballot(0, 1, 2, 3),
        ballot(0, 1, 2, 3),
        ballot(0, 1, 2, 3),
        ballot(0, 1, 2, 3),
        ballot(1, 0, 2, 3),
        ballot(1, 0, 2, 3),
        ballot(1, 0, 2, 3),
        ballot(2, 0, 1, 3),
        ballot(3, 0, 1, 2),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        const firstRound = result.rounds[0];
        expect(firstRound.eliminated).not.toBeNull();
        if (firstRound.eliminated) {
          expect(firstRound.eliminated.reason).toBe("safe_batch");
          expect([...firstRound.eliminated.optionIds].sort()).toEqual([
            optionId(2),
            optionId(3),
          ]);
        }
        expect(result.winnerId).toBe(optionId(0));
      }
    });

    it("batch-eliminates three or more options tied for last when safe", () => {
      // A=6, B=4, C=1, D=1, E=1 (total 13). No majority (need >6.5 → 7).
      // Tied last C+D+E combined 3 < B=4 → safe_batch of three.
      const options = makeOptions(5);
      const ballots: IrvBallot[] = [
        ballot(0),
        ballot(0),
        ballot(0),
        ballot(0),
        ballot(0),
        ballot(0),
        ballot(1),
        ballot(1),
        ballot(1),
        ballot(1),
        ballot(2),
        ballot(3),
        ballot(4),
      ];
      const result = tabulateIrv({ ballots, options });
      const firstRound = result.rounds[0];
      expect(firstRound.eliminated).not.toBeNull();
      if (firstRound.eliminated) {
        expect(firstRound.eliminated.reason).toBe("safe_batch");
        expect(firstRound.eliminated.optionIds.length).toBe(3);
        expect([...firstRound.eliminated.optionIds].sort()).toEqual([
          optionId(2),
          optionId(3),
          optionId(4),
        ]);
      }
    });

    it("does NOT batch-eliminate when combined tied votes >= next-lowest (A=40 B=30 C=30)", () => {
      // No majority (40 ≯ 50). B+C combined 60 ≮ 40 → not safe batch.
      // No earlier Round distinguishes B and C → unresolved naming B and C.
      const options = makeOptions(3);
      const ballots: IrvBallot[] = [];
      for (let i = 0; i < 40; i++) ballots.push(ballot(0, 1, 2));
      for (let i = 0; i < 30; i++) ballots.push(ballot(1, 0, 2));
      for (let i = 0; i < 30; i++) ballots.push(ballot(2, 0, 1));
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.rounds.length).toBe(1);
        expect(result.rounds[0].eliminated).toBeNull();
        expect(result.tiedOptionIds).toEqual([optionId(1), optionId(2)]);
        expect(result.standingCounts.get(optionId(0))).toBe(40);
        expect(result.standingCounts.get(optionId(1))).toBe(30);
        expect(result.standingCounts.get(optionId(2))).toBe(30);
      }
    });
  });

  describe("backward tie-breaking", () => {
    it("eliminates the option with fewer votes in the most recent distinguishing round", () => {
      // R1: A=4, B=3, C=2, D=1 → eliminate D (fewest). D transfers to C.
      // R2: A=4, B=3, C=3. B+C tied last; combined 6 ≮ A=4 → unsafe.
      // Backward: R1 B=3 > C=2 → eliminate C with backward_tie_break.
      // R3: A=4, B=6 (C's 3 + prior B) after C's ballots transfer via C>B? Wait.
      // Ballots: C was ballot(2,0,1,3) → after C out, transfer to A.
      // Actually R2 counts before elim: A=4,B=3,C=3.
      // After elim C: C ballots (3) go to A (prefs C>A>B>D).
      // R3: A=7, B=3 → A majority.
      const options = makeOptions(4);
      const ballots: IrvBallot[] = [
        ballot(0, 1, 2, 3),
        ballot(0, 1, 2, 3),
        ballot(0, 1, 2, 3),
        ballot(0, 1, 2, 3),
        ballot(1, 0, 2, 3),
        ballot(1, 0, 2, 3),
        ballot(1, 0, 2, 3),
        ballot(2, 0, 1, 3),
        ballot(2, 0, 1, 3),
        ballot(3, 2, 0, 1),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.rounds[0].eliminated).toEqual({
          optionIds: [optionId(3)],
          reason: "fewest_votes",
        });
        expect(result.rounds[1].eliminated).toEqual({
          optionIds: [optionId(2)],
          reason: "backward_tie_break",
        });
        expect(result.winnerId).toBe(optionId(0));
      }
    });
  });

  describe("unresolved ties", () => {
    it("halts with named tied options when no earlier round distinguishes them", () => {
      const options = makeOptions(2);
      const ballots: IrvBallot[] = [ballot(0, 1), ballot(1, 0)];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.tiedOptionIds).toEqual([optionId(0), optionId(1)]);
        expect(result.tiedOptionLabels).toEqual(["Option 0", "Option 1"]);
        expect(result.rounds.length).toBe(1);
        expect(result.rounds[0].eliminated).toBeNull();
        expect(result.standingCounts.get(optionId(0))).toBe(1);
        expect(result.standingCounts.get(optionId(1))).toBe(1);
      }
    });

    it("reports unresolved as a terminal result, never an error", () => {
      const options = makeOptions(3);
      const ballots: IrvBallot[] = [
        ballot(0, 1, 2),
        ballot(1, 2, 0),
        ballot(2, 0, 1),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.tiedOptionIds.length).toBeGreaterThan(0);
        expect(result.rounds.length).toBeGreaterThan(0);
        expect(result.rounds[result.rounds.length - 1].eliminated).toBeNull();
      }
    });
  });

  describe("exhaustion tracking", () => {
    it("tracks exhausted ballots per round when all ranked options are eliminated", () => {
      // R1: A=5, B=3, C=2 (total 10). No majority. Elim C fewest.
      // C's two sole-C ballots exhaust.
      // R2: A=5, B=3, exhausted=2, active=8. A majority (5 > 4).
      const options = makeOptions(3);
      const ballots: IrvBallot[] = [
        ballot(0, 1),
        ballot(0, 1),
        ballot(0, 1),
        ballot(0, 1),
        ballot(0, 1),
        ballot(1),
        ballot(1),
        ballot(1),
        ballot(2),
        ballot(2),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.rounds[0].eliminated).toEqual({
          optionIds: [optionId(2)],
          reason: "fewest_votes",
        });
        expect(result.rounds[0].exhaustedCount).toBe(0);
        expect(result.rounds[1].exhaustedCount).toBe(2);
        expect(result.rounds[1].activeBallotCount).toBe(8);
        expect(sumCounts(result.rounds[1].counts)).toBe(
          result.rounds[1].activeBallotCount,
        );
        expect(result.winnerId).toBe(optionId(0));
      }
    });
  });

  describe("edge cases", () => {
    it("returns empty rounds for zero options", () => {
      const result = tabulateIrv({ ballots: [], options: [] });
      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.rounds.length).toBe(0);
        expect(result.tiedOptionIds).toEqual([]);
      }
    });

    it("single option wins immediately", () => {
      const options = makeOptions(1);
      const ballots: IrvBallot[] = [ballot(0), ballot(0)];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.winnerId).toBe(optionId(0));
        expect(result.rounds.length).toBe(1);
      }
    });

    it("handles partial ballots where some options are unranked", () => {
      // A=3, B=1, C=1 (total 5) → A strict majority on partial rankings.
      const options = makeOptions(3);
      const ballots: IrvBallot[] = [
        ballot(0),
        ballot(0),
        ballot(0),
        ballot(1),
        ballot(2),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.winnerId).toBe(optionId(0));
        expect(result.rounds[0].counts.get(optionId(0))).toBe(3);
      }
    });

    it("handles zero ballots with empty rounds (no synthetic tie round)", () => {
      const options = makeOptions(3);
      const result = tabulateIrv({ ballots: [], options });
      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.rounds.length).toBe(0);
        expect(result.tiedOptionIds).toEqual([]);
      }
    });

    it("last remaining option wins even when all ballots are exhausted", () => {
      // Single-option Poll: ballots rank only unknown IDs → all exhausted.
      // Sole remaining survivor still wins with zero active ballots (D3).
      const options = makeOptions(1);
      const ballots: IrvBallot[] = [
        { preferences: ["ghost-a" as PollOptionId] },
        { preferences: ["ghost-b" as PollOptionId] },
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.winnerId).toBe(optionId(0));
        const finalRound = result.rounds[0];
        expect(finalRound.activeBallotCount).toBe(0);
        expect(finalRound.exhaustedCount).toBe(2);
        expect(finalRound.counts.get(optionId(0))).toBe(0);
      }
    });

    it("treats empty preferences as exhausted (Vote-boundary regression surface)", () => {
      const options = makeOptions(2);
      const ballots: IrvBallot[] = [
        { preferences: [] },
        { preferences: [] },
        ballot(0, 1),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.winnerId).toBe(optionId(0));
        expect(result.rounds[0].exhaustedCount).toBe(2);
        expect(result.rounds[0].activeBallotCount).toBe(1);
      }
    });

    it("skips duplicate preference IDs and counts the first remaining occurrence", () => {
      // Ballot ranks A, A, B — first remaining match is A once.
      const options = makeOptions(2);
      const ballots: IrvBallot[] = [
        { preferences: [optionId(0), optionId(0), optionId(1)] },
        ballot(1, 0),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.rounds[0].counts.get(optionId(0))).toBe(1);
      expect(result.rounds[0].counts.get(optionId(1))).toBe(1);
    });

    it("skips unknown option IDs and transfers to the next known remaining preference", () => {
      const options = makeOptions(2);
      const ballots: IrvBallot[] = [
        {
          preferences: [
            "ghost" as PollOptionId,
            optionId(1),
            optionId(0),
          ],
        },
        ballot(0, 1),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.rounds[0].counts.get(optionId(1))).toBe(1);
      expect(result.rounds[0].counts.get(optionId(0))).toBe(1);
      expect(result.rounds[0].exhaustedCount).toBe(0);
    });

    it("does not use option position for elimination or tie-breaking", () => {
      const ballots: IrvBallot[] = [
        ballot(0, 1, 2),
        ballot(0, 1, 2),
        ballot(1, 2, 0),
        ballot(2, 1, 0),
        ballot(2, 1, 0),
      ];
      const base = makeOptions(3);
      const reversedPositions: IrvOptionSet[] = base.map((opt, index) => ({
        ...opt,
        position: base.length - 1 - index,
      }));
      const left = tabulateIrv({ ballots, options: base });
      const right = tabulateIrv({ ballots, options: reversedPositions });
      expect(outcomesEqual(left, right)).toBe(true);
    });

    it("rejects mutation of returned counts maps", () => {
      const result = tabulateIrv({
        ballots: [ballot(0, 1), ballot(1, 0)],
        options: makeOptions(2),
      });
      const counts = result.rounds[0].counts as Map<PollOptionId, number>;
      expect(counts.get(optionId(0))).toBe(1);
      expect(() => counts.set(optionId(0), 99)).toThrow(/immutable/);
      expect(counts.get(optionId(0))).toBe(1);
      if (!result.resolved) {
        const standing = result.standingCounts as Map<PollOptionId, number>;
        expect(() => standing.set(optionId(0), 99)).toThrow(/immutable/);
      }
    });
  });

  describe("determinism property", () => {
    it("produces identical full outcomes across multiple runs for the same input", () => {
      fc.assert(
        fc.property(arbitraryInput(2, 6, 1, 50), (input: TabulateIrvInput) => {
          const first = tabulateIrv(input);
          const second = tabulateIrv(input);
          const third = tabulateIrv(input);
          expect(outcomesEqual(first, second)).toBe(true);
          expect(outcomesEqual(second, third)).toBe(true);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("majority / last-remaining invariant property", () => {
    it("a resolved winner holds strict majority or is the sole remaining survivor", () => {
      fc.assert(
        fc.property(arbitraryInput(2, 5, 3, 50), (input: TabulateIrvInput) => {
          const result = tabulateIrv(input);
          if (!result.resolved) return;
          const finalRound = result.rounds[result.rounds.length - 1];
          const winnerCount = finalRound.counts.get(result.winnerId) ?? 0;
          const majorityWin =
            finalRound.activeBallotCount > 0 &&
            winnerCount > finalRound.activeBallotCount / 2;
          // Sole-survivor path: final round has only the winner in counts.
          const soleSurvivor =
            finalRound.counts.size === 1 &&
            finalRound.counts.has(result.winnerId);
          expect(majorityWin || soleSurvivor).toBe(true);
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("safe batch elimination property", () => {
    it("batch elimination only fires when combined tied votes < next-lowest", () => {
      fc.assert(
        fc.property(arbitraryInput(3, 6, 3, 50), (input: TabulateIrvInput) => {
          const result = tabulateIrv(input);
          for (const round of result.rounds) {
            if (
              round.eliminated !== null &&
              round.eliminated.reason === "safe_batch"
            ) {
              const eliminatedIds = round.eliminated.optionIds;
              const perOptionVotes =
                round.counts.get(eliminatedIds[0]) ?? 0;
              for (const id of eliminatedIds) {
                expect(round.counts.get(id)).toBe(perOptionVotes);
              }
              const combined = perOptionVotes * eliminatedIds.length;
              const remainingCounts: number[] = [];
              for (const [id, count] of round.counts) {
                if (!eliminatedIds.includes(id)) {
                  remainingCounts.push(count);
                }
              }
              expect(remainingCounts.length).toBeGreaterThan(0);
              const nextLowest = Math.min(...remainingCounts);
              expect(combined).toBeLessThan(nextLowest);
            }
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("backward tie-break property", () => {
    it("backward_tie_break eliminates only the lowest of the prior distinguishing Round among the current tied-last group", () => {
      fc.assert(
        fc.property(arbitraryInput(3, 6, 3, 50), (input: TabulateIrvInput) => {
          const result = tabulateIrv(input);
          for (let i = 0; i < result.rounds.length; i++) {
            const round = result.rounds[i];
            if (
              round.eliminated === null ||
              round.eliminated.reason !== "backward_tie_break"
            ) {
              continue;
            }
            expect(i).toBeGreaterThan(0);
            expect(round.eliminated.optionIds.length).toBeGreaterThan(0);
            for (const id of round.eliminated.optionIds) {
              expect(round.counts.has(id)).toBe(true);
            }
            const sorted = [...round.eliminated.optionIds].sort();
            expect(round.eliminated.optionIds).toEqual(sorted);

            // Reconstruct the tied-last group in this Round (all at min count).
            let minCount = Infinity;
            for (const count of round.counts.values()) {
              if (count < minCount) minCount = count;
            }
            const tiedLast: PollOptionId[] = [];
            for (const [id, count] of round.counts) {
              if (count === minCount) tiedLast.push(id);
            }
            // Eliminated must be a non-empty subset of that group.
            for (const id of round.eliminated.optionIds) {
              expect(tiedLast).toContain(id);
            }
            expect(round.eliminated.optionIds.length).toBeLessThanOrEqual(
              tiedLast.length,
            );

            // FR-9: in the most recent earlier Round that distinguishes the
            // group, eliminated IDs hold the minimum count among the group,
            // and at least one other group member has a strictly higher count.
            let distinguishing: IrvRound | null = null;
            for (let r = i - 1; r >= 0; r--) {
              const prior = result.rounds[r];
              const priorCounts = tiedLast.map(
                (id) => prior.counts.get(id) ?? 0,
              );
              const first = priorCounts[0];
              if (priorCounts.some((c) => c !== first)) {
                distinguishing = prior;
                break;
              }
            }
            expect(distinguishing).not.toBeNull();
            if (distinguishing === null) return;
            const groupCounts = tiedLast.map((id) => ({
              id,
              count: distinguishing.counts.get(id) ?? 0,
            }));
            const priorMin = Math.min(...groupCounts.map((e) => e.count));
            const priorMax = Math.max(...groupCounts.map((e) => e.count));
            expect(priorMax).toBeGreaterThan(priorMin);
            for (const id of round.eliminated.optionIds) {
              expect(distinguishing.counts.get(id) ?? 0).toBe(priorMin);
            }
            // Every tied-last member at priorMin must be eliminated (full min set).
            const expectedEliminated = groupCounts
              .filter((e) => e.count === priorMin)
              .map((e) => e.id)
              .sort();
            expect([...round.eliminated.optionIds].sort()).toEqual(
              expectedEliminated,
            );
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("round integrity property", () => {
    it("rounds are contiguous from 1, terminal rounds have no elimination, fewest_votes removes exactly one", () => {
      fc.assert(
        fc.property(arbitraryInput(2, 6, 1, 50), (input: TabulateIrvInput) => {
          const result = tabulateIrv(input);
          for (let i = 0; i < result.rounds.length; i++) {
            expect(result.rounds[i].roundNumber).toBe(i + 1);
          }
          if (result.rounds.length === 0) return;
          const last = result.rounds[result.rounds.length - 1];
          // Terminal round (winner or unresolved) always has eliminated: null.
          if (
            result.resolved ||
            (!result.resolved && result.tiedOptionIds.length > 0)
          ) {
            expect(last.eliminated).toBeNull();
          }
          for (const round of result.rounds) {
            if (
              round.eliminated !== null &&
              round.eliminated.reason === "fewest_votes"
            ) {
              expect(round.eliminated.optionIds.length).toBe(1);
            }
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("unresolved ties property", () => {
    it("unresolved outcomes name tied options, have no final elimination, and include standing counts", () => {
      fc.assert(
        fc.property(arbitraryInput(2, 6, 1, 50), (input: TabulateIrvInput) => {
          const result = tabulateIrv(input);
          if (result.resolved) return;
          if (result.rounds.length === 0) {
            expect(result.tiedOptionIds).toEqual([]);
            return;
          }
          expect(result.tiedOptionIds.length).toBeGreaterThan(0);
          expect(result.tiedOptionIds).toEqual(
            [...result.tiedOptionIds].sort(),
          );
          expect(result.tiedOptionLabels.length).toBe(
            result.tiedOptionIds.length,
          );
          const last = result.rounds[result.rounds.length - 1];
          expect(last.eliminated).toBeNull();
          for (const id of result.tiedOptionIds) {
            expect(result.standingCounts.has(id)).toBe(true);
          }
        }),
        { numRuns: 200 },
      );
    });
  });

  describe("exhaustion property", () => {
    it("active counts sum to activeBallotCount and exhaustion is non-negative and bounded", () => {
      fc.assert(
        fc.property(arbitraryInput(2, 6, 1, 50), (input: TabulateIrvInput) => {
          const result = tabulateIrv(input);
          const totalBallots = input.ballots.length;
          for (const round of result.rounds) {
            expect(round.exhaustedCount).toBeGreaterThanOrEqual(0);
            expect(round.activeBallotCount).toBeGreaterThanOrEqual(0);
            expect(round.exhaustedCount + round.activeBallotCount).toBe(
              totalBallots,
            );
            expect(sumCounts(round.counts)).toBe(round.activeBallotCount);
          }
        }),
        { numRuns: 200 },
      );
    });
  });
});
