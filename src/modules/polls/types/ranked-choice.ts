// Ranked Choice — normalized ordered Ballot facts behind the frozen AD-3
// Poll Type contract. A Ballot is a non-empty ordered subset of known Poll
// options; rankings are relational facts, never JSON or option-row order.

import {
  POLL_TYPE_CONTRACT_VERSION,
  type PollTypeExportProjection,
  type PollTypeStrategy,
  type Result,
} from "../../../shared/application/index";
import type { PollOptionId } from "../../../shared/domain/index";
import {
  tabulateAndProjectRanked,
  type RankedTallyView,
} from "../../results/index";
import { POLL_CAPS } from "../caps";
import type { IrvBallot, IrvOptionSet } from "../../results/tabulate-irv";

export type RankedChoiceCreateInput = {
  optionLabels: string[];
};

export type RankedChoiceCreationFacts = {
  options: { label: string; position: number }[];
  multiSelect: false;
  minSelections: null;
  maxSelections: null;
};

export type RankedChoiceValidationFacts = {
  options: { id: PollOptionId; label: string; position: number }[];
};

export type RankedPreferenceInput = {
  optionId: string;
  rank: number;
};

export type RankedChoiceVoteSubmission = {
  kind: "ranked_choice";
  selectedOptionIds: readonly string[];
  rankedPreferences: readonly RankedPreferenceInput[];
};

export type RankedChoiceValidatedSubmission = {
  kind: "ranked_choice";
  selectedOptionIds: readonly PollOptionId[];
  rankedPreferences: readonly {
    pollOptionId: PollOptionId;
    rank: number;
  }[];
};

export type RankedChoicePersistedFacts = {
  preferences: {
    pollOptionId: PollOptionId;
    rank: number;
  }[];
};

/** Multi-ballot input for the pure strategy projector (tests / AD-3). */
export type RankedChoiceResultsFacts = {
  options: IrvOptionSet[];
  ballots: IrvBallot[];
};

export type RankedChoiceExportFacts = {
  options: {
    label: string;
    position: number;
    count: number;
  }[];
  votes: {
    alignmentKey: number;
    createdAtMs: number;
    rankedOptionPositions: number[];
  }[];
  voterCount: number;
  selectionCount: number;
};

type RankedChoiceStrategy = Omit<
  PollTypeStrategy<
    RankedChoiceCreateInput,
    RankedChoiceCreationFacts,
    RankedChoiceVoteSubmission,
    RankedChoiceValidatedSubmission,
    RankedChoicePersistedFacts,
    RankedChoiceResultsFacts,
    RankedChoiceExportFacts,
    PollTypeExportProjection
  >,
  "validateSubmission" | "projectResults" | "projectExport"
> & {
  validateSubmission: (
    submission: RankedChoiceVoteSubmission,
    facts: RankedChoiceValidationFacts,
  ) => Result<RankedChoiceValidatedSubmission>;
  /** Pure IRV projection — same tabulator as the D1 Results adapter (AD-9). */
  projectResults: (facts: RankedChoiceResultsFacts) => RankedTallyView;
  projectExport: (
    facts: RankedChoiceExportFacts,
  ) => Result<PollTypeExportProjection>;
};

const invalidRanking = (
  code: "ranking_required" | "invalid_ranking",
  message: string,
): Result<RankedChoiceValidatedSubmission> => ({
  ok: false,
  error: {
    code,
    message,
    fieldErrors: { rankedPreferences: message },
    reasonCodes: { rankedPreferences: code },
  },
});

export const rankedChoiceStrategy: RankedChoiceStrategy = {
  type: "ranked_choice",
  contractVersion: POLL_TYPE_CONTRACT_VERSION,
  create: (input) => ({
    ok: true,
    value: {
      options: input.optionLabels.map((label, position) => ({
        label,
        position,
      })),
      multiSelect: false,
      minSelections: null,
      maxSelections: null,
    },
  }),
  validateSubmission: (submission, facts) => {
    const preferences = submission.rankedPreferences;
    if (preferences.length === 0) {
      return invalidRanking(
        "ranking_required",
        "Rank at least one option, then vote.",
      );
    }

    const knownOptionIds = new Set(facts.options.map(({ id }) => id));
    const seenOptions = new Set<string>();
    const seenRanks = new Set<number>();
    for (const preference of preferences) {
      if (
        typeof preference.optionId !== "string" ||
        preference.optionId.length === 0 ||
        !Number.isSafeInteger(preference.rank) ||
        preference.rank < 1 ||
        seenOptions.has(preference.optionId) ||
        seenRanks.has(preference.rank) ||
        !knownOptionIds.has(preference.optionId as PollOptionId)
      ) {
        return invalidRanking(
          "invalid_ranking",
          "That ranking does not match this Poll.",
        );
      }
      seenOptions.add(preference.optionId);
      seenRanks.add(preference.rank);
    }

    if (
      preferences.length > facts.options.length ||
      !preferences.every((_, index) => seenRanks.has(index + 1))
    ) {
      return invalidRanking(
        "invalid_ranking",
        "That ranking does not match this Poll.",
      );
    }

    const rankedPreferences = [...preferences]
      .sort((left, right) => left.rank - right.rank)
      .map(({ optionId, rank }) => ({
        pollOptionId: optionId as PollOptionId,
        rank,
      }));
    return {
      ok: true,
      value: {
        kind: "ranked_choice",
        selectedOptionIds: rankedPreferences.map(
          ({ pollOptionId }) => pollOptionId,
        ),
        rankedPreferences,
      },
    };
  },
  persistFacts: (validated) => ({
    preferences: validated.rankedPreferences.map((preference) => ({
      ...preference,
    })),
  }),
  projectResults: (facts) =>
    tabulateAndProjectRanked({
      ballots: facts.ballots,
      options: facts.options,
    }),
  projectExport: (facts) => {
    const malformed = () => ({
      ok: false as const,
      error: {
        code: "export_projection_invalid",
        message: "Export data is unavailable right now.",
      },
    });
    if (
      !Number.isSafeInteger(facts.voterCount) ||
      facts.voterCount < 0 ||
      !Number.isSafeInteger(facts.selectionCount) ||
      facts.selectionCount < 0 ||
      facts.votes.length !== facts.voterCount
    ) {
      return malformed();
    }

    const options = [...facts.options];
    const labels = options.map(({ label }) => label);
    if (
      options.length < 2 ||
      options.length > POLL_CAPS.maxOptions ||
      options.some(
        (option, index) =>
          option.position !== index ||
          typeof option.label !== "string" ||
          option.label.length === 0 ||
          option.label !== option.label.trim() ||
          option.label.includes("\0") ||
          [...option.label].length > POLL_CAPS.maxOptionLength ||
          !Number.isSafeInteger(option.count) ||
          option.count < 0 ||
          option.count > facts.voterCount,
      ) ||
      new Set(labels).size !== labels.length
    ) {
      return malformed();
    }

    const maxRankings = options.length;
    const voteRows: PollTypeExportProjection["votes"]["rows"][number][] = [];
    let totalSelections = 0;
    for (const [voteIndex, vote] of facts.votes.entries()) {
      if (
        !Number.isSafeInteger(vote.alignmentKey) ||
        vote.alignmentKey !== voteIndex ||
        !Number.isSafeInteger(vote.createdAtMs) ||
        vote.createdAtMs < 0 ||
        (voteIndex > 0 &&
          vote.createdAtMs < facts.votes[voteIndex - 1]!.createdAtMs)
      ) {
        return malformed();
      }
      if (
        vote.rankedOptionPositions.length === 0 ||
        vote.rankedOptionPositions.length > maxRankings
      ) {
        return malformed();
      }
      const seen = new Set<number>();
      const rankedLabels: string[] = [];
      for (const pos of vote.rankedOptionPositions) {
        if (
          !Number.isSafeInteger(pos) ||
          pos < 0 ||
          pos >= options.length ||
          seen.has(pos)
        ) {
          return malformed();
        }
        seen.add(pos);
        rankedLabels.push(options[pos]!.label);
        totalSelections += 1;
      }
      voteRows.push({
        alignmentKey: vote.alignmentKey,
        cells: Array.from(
          { length: maxRankings },
          (_, index) => rankedLabels[index] ?? "",
        ),
      });
    }

    if (totalSelections !== facts.selectionCount) {
      return malformed();
    }

    return {
      ok: true,
      value: {
        votes: {
          columns: Array.from(
            { length: maxRankings },
            (_, index) => `RANK ${index + 1}`,
          ),
          rows: voteRows,
        },
        tally: {
          columns: ["OPTION", "COUNT"],
          rows: options.map((option) => [option.label, option.count]),
        },
        voterCount: facts.voterCount,
        selectionCount: facts.selectionCount,
      },
    };
  },
};
