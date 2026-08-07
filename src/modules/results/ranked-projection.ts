// Serializable Ranked Tally projection (Story 5.2). Maps the pure tabulator's
// Map-based IrvOutcome into JSON-safe, delivery-ready shapes. Provider-free.

import type { PollOptionId } from "../../shared/domain/index";
import {
  tabulateIrv,
  type IrvBallot,
  type IrvEliminationReason,
  type IrvOptionSet,
  type IrvOutcome,
  type IrvRound,
} from "./tabulate-irv";

export type RankedOptionCountView = {
  readonly optionId: PollOptionId;
  readonly label: string;
  readonly position: number;
  readonly count: number;
};

export type RankedEliminationView = {
  readonly optionIds: readonly PollOptionId[];
  readonly labels: readonly string[];
  readonly reason: IrvEliminationReason;
  readonly backwardTieBreakRound?: number;
};

export type RankedRoundView = {
  readonly roundNumber: number;
  readonly counts: readonly RankedOptionCountView[];
  readonly exhaustedCount: number;
  readonly activeBallotCount: number;
  readonly eliminated: RankedEliminationView | null;
};

/** Outward ranked tally — no Maps, no voter/ballot identifiers. */
export type RankedTallyView = {
  readonly empty: boolean;
  readonly voterCount: number;
  readonly resolved: boolean;
  readonly winnerId: PollOptionId | null;
  readonly winnerLabel: string | null;
  readonly tiedOptionIds: readonly PollOptionId[];
  readonly tiedOptionLabels: readonly string[];
  /** Final standing (last Round counts), position-ordered. */
  readonly finalCounts: readonly RankedOptionCountView[];
  readonly rounds: readonly RankedRoundView[];
};

export type VersionedRankedTallyProjection = RankedTallyView & {
  readonly representationVersion: number;
};

function labelFor(
  optionMap: ReadonlyMap<PollOptionId, IrvOptionSet>,
  optionId: PollOptionId,
): string {
  return optionMap.get(optionId)?.label ?? "";
}

function positionFor(
  optionMap: ReadonlyMap<PollOptionId, IrvOptionSet>,
  optionId: PollOptionId,
): number {
  return optionMap.get(optionId)?.position ?? Number.MAX_SAFE_INTEGER;
}

function countsToView(
  counts: ReadonlyMap<PollOptionId, number>,
  optionMap: ReadonlyMap<PollOptionId, IrvOptionSet>,
): RankedOptionCountView[] {
  return [...counts.entries()]
    .map(([optionId, count]) => ({
      optionId,
      label: labelFor(optionMap, optionId),
      position: positionFor(optionMap, optionId),
      count,
    }))
    .sort((left, right) => left.position - right.position);
}

function mapRound(
  round: IrvRound,
  optionMap: ReadonlyMap<PollOptionId, IrvOptionSet>,
): RankedRoundView {
  return {
    roundNumber: round.roundNumber,
    counts: countsToView(round.counts, optionMap),
    exhaustedCount: round.exhaustedCount,
    activeBallotCount: round.activeBallotCount,
    eliminated:
      round.eliminated === null
        ? null
        : {
            optionIds: round.eliminated.optionIds,
            labels: round.eliminated.optionIds.map((id) =>
              labelFor(optionMap, id),
            ),
            reason: round.eliminated.reason,
            ...(round.eliminated.backwardTieBreakRound !== undefined
              ? { backwardTieBreakRound: round.eliminated.backwardTieBreakRound }
              : {}),
          },
  };
}

/**
 * Project a pure IRV outcome into the delivery-facing RankedTallyView.
 * `voterCount` is the number of accepted Ballots (not active-in-round).
 */
export function projectRankedTallyView(
  outcome: IrvOutcome,
  options: readonly IrvOptionSet[],
  voterCount: number,
): RankedTallyView {
  const optionMap = new Map(options.map((option) => [option.id, option]));
  const rounds = outcome.rounds.map((round) => mapRound(round, optionMap));
  const empty = voterCount === 0 || rounds.length === 0;

  if (outcome.resolved) {
    const finalRound = rounds[rounds.length - 1];
    return {
      empty,
      voterCount,
      resolved: true,
      winnerId: outcome.winnerId,
      winnerLabel: outcome.winnerLabel,
      tiedOptionIds: [],
      tiedOptionLabels: [],
      finalCounts: finalRound?.counts ?? [],
      rounds,
    };
  }

  const finalRound = rounds[rounds.length - 1];
  const standing =
    finalRound?.counts ??
    countsToView(outcome.standingCounts, optionMap);

  return {
    empty,
    voterCount,
    resolved: false,
    winnerId: null,
    winnerLabel: null,
    tiedOptionIds: outcome.tiedOptionIds,
    tiedOptionLabels: outcome.tiedOptionLabels,
    finalCounts: standing,
    rounds,
  };
}

/** Single pure path: tabulate then project — used by adapter and strategy. */
export function tabulateAndProjectRanked(input: {
  ballots: readonly IrvBallot[];
  options: readonly IrvOptionSet[];
}): RankedTallyView {
  const outcome = tabulateIrv(input);
  return projectRankedTallyView(outcome, input.options, input.ballots.length);
}
