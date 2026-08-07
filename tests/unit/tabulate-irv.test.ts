import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { PollOptionId } from "../../../src/shared/domain/index";
import {
  tabulateIrv,
  type IrvBallot,
  type IrvOptionSet,
  type TabulateIrvInput,
} from "../../../src/modules/results/tabulate-irv";

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
      }
    });

    it("transfers votes through elimination rounds until majority", () => {
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
        expect(result.rounds.length).toBeGreaterThanOrEqual(2);
      }
    });
  });

  describe("safe batch elimination", () => {
    it("batch-eliminates tied-last group when combined votes < next-lowest", () => {
      const options = makeOptions(4);
      const ballots: IrvBallot[] = [
        ballot(0, 1, 2, 3),
        ballot(0, 1, 2, 3),
        ballot(0, 1, 2, 3),
        ballot(0, 1, 2, 3),
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
        }
      }
    });

    it("does NOT batch-eliminate when combined tied votes >= next-lowest (A=40 B=30 C=30)", () => {
      const options = makeOptions(3);
      const ballots: IrvBallot[] = [];
      for (let i = 0; i < 40; i++) ballots.push(ballot(0, 1, 2));
      for (let i = 0; i < 30; i++) ballots.push(ballot(1, 0, 2));
      for (let i = 0; i < 30; i++) ballots.push(ballot(2, 0, 1));
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        const firstRound = result.rounds[0];
        expect(firstRound.eliminated).not.toBeNull();
        if (firstRound.eliminated) {
          expect(firstRound.eliminated.optionIds.length).toBe(1);
          expect(firstRound.eliminated.reason).not.toBe("safe_batch");
        }
      }
    });
  });

  describe("backward tie-breaking", () => {
    it("eliminates the option with fewer votes in the most recent distinguishing round", () => {
      const options = makeOptions(3);
      const ballots: IrvBallot[] = [
        ballot(0, 1, 2),
        ballot(0, 1, 2),
        ballot(1, 0, 2),
        ballot(2, 0, 1),
        ballot(2, 1, 0),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
    });
  });

  describe("unresolved ties", () => {
    it("halts with named tied options when no earlier round distinguishes them", () => {
      const options = makeOptions(2);
      const ballots: IrvBallot[] = [
        ballot(0, 1),
        ballot(1, 0),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.tiedOptionIds.length).toBe(2);
        expect(result.rounds.length).toBe(1);
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
      }
    });
  });

  describe("exhaustion tracking", () => {
    it("tracks exhausted ballots per round when all ranked options are eliminated", () => {
      const options = makeOptions(3);
      const ballots: IrvBallot[] = [
        ballot(1, 2),
        ballot(2, 1),
        ballot(0, 1, 2),
        ballot(0, 2, 1),
        ballot(0, 1, 2),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        const hasExhaustion = result.rounds.some((r) => r.exhaustedCount > 0);
        expect(hasExhaustion).toBe(true);
      }
    });
  });

  describe("edge cases", () => {
    it("returns empty rounds for zero options", () => {
      const result = tabulateIrv({ ballots: [], options: [] });
      expect(result.resolved).toBe(false);
      if (!result.resolved) {
        expect(result.rounds.length).toBe(0);
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
      const options = makeOptions(3);
      const ballots: IrvBallot[] = [
        ballot(0),
        ballot(0),
        ballot(1),
        ballot(2),
      ];
      const result = tabulateIrv({ ballots, options });
      expect(result.resolved).toBe(true);
      if (result.resolved) {
        expect(result.winnerId).toBe(optionId(0));
      }
    });

    it("handles zero ballots gracefully", () => {
      const options = makeOptions(3);
      const result = tabulateIrv({ ballots: [], options });
      expect(result.resolved).toBe(false);
    });
  });

  describe("determinism property", () => {
    it("produces identical results across multiple runs for the same input", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 6 }).chain((optionCount) =>
            fc.record({
              options: fc.constant(makeOptions(optionCount)),
              ballots: fc.array(
                fc
                  .subarray([...Array(optionCount).keys()], { minLength: 1 })
                  .map((indices) => ballot(...indices)),
                { minLength: 1, maxLength: 50 },
              ),
            }),
          ),
          (input: TabulateIrvInput) => {
            const first = tabulateIrv(input);
            const second = tabulateIrv(input);
            const third = tabulateIrv(input);

            expect(first.resolved).toBe(second.resolved);
            expect(second.resolved).toBe(third.resolved);

            if (first.resolved && second.resolved && third.resolved) {
              expect(first.winnerId).toBe(second.winnerId);
              expect(second.winnerId).toBe(third.winnerId);
            }

            expect(first.rounds.length).toBe(second.rounds.length);
            expect(second.rounds.length).toBe(third.rounds.length);

            for (let i = 0; i < first.rounds.length; i++) {
              expect(first.rounds[i].roundNumber).toBe(
                second.rounds[i].roundNumber,
              );
              expect(first.rounds[i].exhaustedCount).toBe(
                second.rounds[i].exhaustedCount,
              );
              expect(first.rounds[i].activeBallotCount).toBe(
                second.rounds[i].activeBallotCount,
              );
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("majority invariant property", () => {
    it("a resolved winner always holds strict majority in the final round", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 2, max: 5 }).chain((optionCount) =>
            fc.record({
              options: fc.constant(makeOptions(optionCount)),
              ballots: fc.array(
                fc
                  .subarray([...Array(optionCount).keys()], { minLength: 1 })
                  .map((indices) => ballot(...indices)),
                { minLength: 3, maxLength: 50 },
              ),
            }),
          ),
          (input: TabulateIrvInput) => {
            const result = tabulateIrv(input);
            if (result.resolved) {
              const finalRound = result.rounds[result.rounds.length - 1];
              const winnerCount =
                finalRound.counts.get(result.winnerId) ?? 0;
              expect(winnerCount).toBeGreaterThan(
                finalRound.activeBallotCount / 2,
              );
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });

  describe("safe batch elimination property", () => {
    it("batch elimination only fires when combined tied votes < next-lowest", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 6 }).chain((optionCount) =>
            fc.record({
              options: fc.constant(makeOptions(optionCount)),
              ballots: fc.array(
                fc
                  .subarray([...Array(optionCount).keys()], { minLength: 1 })
                  .map((indices) => ballot(...indices)),
                { minLength: 3, maxLength: 50 },
              ),
            }),
          ),
          (input: TabulateIrvInput) => {
            const result = tabulateIrv(input);
            for (const round of result.rounds) {
              if (
                round.eliminated !== null &&
                round.eliminated.reason === "safe_batch"
              ) {
                const eliminatedCount = round.eliminated.optionIds.length;
                const perOptionVotes =
                  round.counts.get(round.eliminated.optionIds[0]) ?? 0;
                const combined = perOptionVotes * eliminatedCount;
                const remainingCounts: number[] = [];
                for (const [id, count] of round.counts) {
                  if (!round.eliminated.optionIds.includes(id)) {
                    remainingCounts.push(count);
                  }
                }
                const nextLowest = Math.min(...remainingCounts);
                expect(combined).toBeLessThan(nextLowest);
              }
            }
          },
        ),
        { numRuns: 200 },
      );
    });
  });
});
