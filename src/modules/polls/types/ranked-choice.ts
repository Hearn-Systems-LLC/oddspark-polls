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

type RankedChoiceStrategy = Omit<
  PollTypeStrategy<
    RankedChoiceCreateInput,
    RankedChoiceCreationFacts,
    RankedChoiceVoteSubmission,
    RankedChoiceValidatedSubmission,
    RankedChoicePersistedFacts,
    never,
    never,
    PollTypeExportProjection
  >,
  "validateSubmission" | "projectExport"
> & {
  validateSubmission: (
    submission: RankedChoiceVoteSubmission,
    facts: RankedChoiceValidationFacts,
  ) => Result<RankedChoiceValidatedSubmission>;
  projectExport: () => Result<PollTypeExportProjection>;
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
  projectExport: () => ({
    ok: false,
    error: {
      code: "export_projection_unavailable",
      message: "Ranked Choice export is not available yet.",
    },
  }),
};
