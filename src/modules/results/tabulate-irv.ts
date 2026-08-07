// Pure IRV tabulator (Story 5.2, FR-9, AD-9/AR-7). Zero imports from D1,
// Astro, cookies, request context, or randomness. One function serves every
// consumer: live view, closed result, post-vote surface, and tests. The
// adapter maps SQL rows into the input shape; this module owns only the
// deterministic counting algorithm.

import type { PollOptionId } from "../../shared/domain/index";

export type IrvBallot = {
  readonly preferences: readonly PollOptionId[];
};

export type IrvOptionSet = {
  readonly id: PollOptionId;
  readonly label: string;
  readonly position: number;
};

export type IrvEliminationReason =
  | "fewest_votes"
  | "safe_batch"
  | "backward_tie_break";

export type IrvRound = {
  readonly roundNumber: number;
  readonly counts: ReadonlyMap<PollOptionId, number>;
  readonly exhaustedCount: number;
  readonly activeBallotCount: number;
  readonly eliminated: {
    readonly optionIds: readonly PollOptionId[];
    readonly reason: IrvEliminationReason;
  } | null;
};

export type IrvOutcome =
  | {
      readonly resolved: true;
      readonly winnerId: PollOptionId;
      readonly winnerLabel: string;
      readonly rounds: readonly IrvRound[];
    }
  | {
      readonly resolved: false;
      readonly tiedOptionIds: readonly PollOptionId[];
      readonly tiedOptionLabels: readonly string[];
      readonly standingCounts: ReadonlyMap<PollOptionId, number>;
      readonly rounds: readonly IrvRound[];
    };

export type TabulateIrvInput = {
  readonly ballots: readonly IrvBallot[];
  readonly options: readonly IrvOptionSet[];
};

type MutableCounts = Map<PollOptionId, number>;

function countActiveBallots(
  ballots: readonly IrvBallot[],
  remaining: ReadonlySet<PollOptionId>,
): { counts: MutableCounts; exhaustedCount: number } {
  const counts: MutableCounts = new Map();
  for (const optionId of remaining) {
    counts.set(optionId, 0);
  }
  let exhaustedCount = 0;
  for (const ballot of ballots) {
    let assigned = false;
    for (const preference of ballot.preferences) {
      if (remaining.has(preference)) {
        counts.set(preference, (counts.get(preference) ?? 0) + 1);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      exhaustedCount++;
    }
  }
  return { counts, exhaustedCount };
}

function findStrictMajority(
  counts: ReadonlyMap<PollOptionId, number>,
  activeBallotCount: number,
): PollOptionId | null {
  if (activeBallotCount <= 0) {
    return null;
  }
  const threshold = activeBallotCount / 2;
  for (const [optionId, count] of counts) {
    if (count > threshold) {
      return optionId;
    }
  }
  return null;
}

function findLowestGroup(
  counts: ReadonlyMap<PollOptionId, number>,
  remaining: ReadonlySet<PollOptionId>,
): { optionIds: PollOptionId[]; voteCount: number } {
  let minCount = Infinity;
  for (const optionId of remaining) {
    const count = counts.get(optionId) ?? 0;
    if (count < minCount) {
      minCount = count;
    }
  }
  const lowest: PollOptionId[] = [];
  for (const optionId of remaining) {
    if ((counts.get(optionId) ?? 0) === minCount) {
      lowest.push(optionId);
    }
  }
  return { optionIds: lowest, voteCount: minCount };
}

function findNextLowestCount(
  counts: ReadonlyMap<PollOptionId, number>,
  remaining: ReadonlySet<PollOptionId>,
  excludeCount: number,
): number | null {
  let nextLowest: number | null = null;
  for (const optionId of remaining) {
    const count = counts.get(optionId) ?? 0;
    if (count > excludeCount) {
      if (nextLowest === null || count < nextLowest) {
        nextLowest = count;
      }
    }
  }
  return nextLowest;
}

function canSafeBatchEliminate(
  groupCombinedVotes: number,
  nextLowestCount: number | null,
): boolean {
  if (nextLowestCount === null) {
    return false;
  }
  return groupCombinedVotes < nextLowestCount;
}

function backwardTieBreak(
  rounds: readonly IrvRound[],
  tiedOptionIds: readonly PollOptionId[],
): { eliminated: PollOptionId[]; reason: IrvEliminationReason } | null {
  for (let i = rounds.length - 1; i >= 0; i--) {
    const round = rounds[i];
    const countsInRound: Array<{ id: PollOptionId; count: number }> = [];
    for (const optionId of tiedOptionIds) {
      countsInRound.push({
        id: optionId,
        count: round.counts.get(optionId) ?? 0,
      });
    }
    const allSame = countsInRound.every(
      ({ count }) => count === countsInRound[0].count,
    );
    if (!allSame) {
      let minCount = Infinity;
      for (const entry of countsInRound) {
        if (entry.count < minCount) {
          minCount = entry.count;
        }
      }
      const eliminated = countsInRound
        .filter(({ count }) => count === minCount)
        .map(({ id }) => id);
      return { eliminated, reason: "backward_tie_break" };
    }
  }
  return null;
}

export function tabulateIrv(input: TabulateIrvInput): IrvOutcome {
  const { ballots, options } = input;
  if (options.length === 0) {
    return {
      resolved: false,
      tiedOptionIds: [],
      tiedOptionLabels: [],
      standingCounts: new Map(),
      rounds: [],
    };
  }

  const optionMap = new Map<PollOptionId, IrvOptionSet>();
  for (const option of options) {
    optionMap.set(option.id, option);
  }

  const remaining = new Set<PollOptionId>(options.map((o) => o.id));
  const rounds: IrvRound[] = [];
  let roundNumber = 0;

  while (remaining.size > 0) {
    roundNumber++;
    const { counts, exhaustedCount } = countActiveBallots(ballots, remaining);
    const activeBallotCount = ballots.length - exhaustedCount;

    const winnerId = findStrictMajority(counts, activeBallotCount);
    if (winnerId !== null) {
      const round: IrvRound = {
        roundNumber,
        counts: new Map(counts),
        exhaustedCount,
        activeBallotCount,
        eliminated: null,
      };
      rounds.push(round);
      const winner = optionMap.get(winnerId);
      return {
        resolved: true,
        winnerId,
        winnerLabel: winner?.label ?? "",
        rounds,
      };
    }

    if (remaining.size === 1) {
      const lastId = [...remaining][0];
      const round: IrvRound = {
        roundNumber,
        counts: new Map(counts),
        exhaustedCount,
        activeBallotCount,
        eliminated: null,
      };
      rounds.push(round);
      const winner = optionMap.get(lastId);
      return {
        resolved: true,
        winnerId: lastId,
        winnerLabel: winner?.label ?? "",
        rounds,
      };
    }

    const lowest = findLowestGroup(counts, remaining);
    const combinedVotes = lowest.voteCount * lowest.optionIds.length;
    const nextLowest = findNextLowestCount(
      counts,
      remaining,
      lowest.voteCount,
    );

    let eliminationDecision: {
      eliminated: PollOptionId[];
      reason: IrvEliminationReason;
    };

    if (
      lowest.optionIds.length > 1 &&
      canSafeBatchEliminate(combinedVotes, nextLowest)
    ) {
      eliminationDecision = {
        eliminated: lowest.optionIds,
        reason: "safe_batch",
      };
    } else if (lowest.optionIds.length > 1) {
      const backwardResult = backwardTieBreak(rounds, lowest.optionIds);
      if (backwardResult !== null) {
        eliminationDecision = backwardResult;
      } else {
        const round: IrvRound = {
          roundNumber,
          counts: new Map(counts),
          exhaustedCount,
          activeBallotCount,
          eliminated: null,
        };
        rounds.push(round);
        const sortedTied = [...lowest.optionIds].sort();
        return {
          resolved: false,
          tiedOptionIds: sortedTied,
          tiedOptionLabels: sortedTied.map(
            (id) => optionMap.get(id)?.label ?? "",
          ),
          standingCounts: new Map(counts),
          rounds,
        };
      }
    } else {
      eliminationDecision = {
        eliminated: lowest.optionIds,
        reason: "fewest_votes",
      };
    }

    const round: IrvRound = {
      roundNumber,
      counts: new Map(counts),
      exhaustedCount,
      activeBallotCount,
      eliminated: {
        optionIds: eliminationDecision.eliminated,
        reason: eliminationDecision.reason,
      },
    };
    rounds.push(round);

    for (const id of eliminationDecision.eliminated) {
      remaining.delete(id);
    }
  }

  return {
    resolved: false,
    tiedOptionIds: [],
    tiedOptionLabels: [],
    standingCounts: new Map(),
    rounds,
  };
}
