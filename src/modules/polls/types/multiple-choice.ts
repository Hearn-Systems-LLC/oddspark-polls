// Multiple-Choice — the first Poll Type strategy behind the AD-3 contract
// and the precedent-setter for its shape. `create` normalizes labels into
// positioned option facts; `validateSubmission`/`persistFacts` arrive with
// Story 1.5, projection data with Story 1.7, and its result surface with 1.8.

import {
  POLL_TYPE_CONTRACT_VERSION,
  type PollTypeStrategy,
  type Result,
} from "../../../shared/application/index";
import type { PollOptionId } from "../../../shared/domain/index";

export type MultipleChoiceCreateInput = {
  optionLabels: string[];
  multiSelect: boolean;
  minSelections: number | null;
  maxSelections: number | null;
};

// Creation facts carry no option ids — the Polls command assigns ids when it
// commits the creation batch, so nothing at creation time can reference one.
export type MultipleChoiceCreationFacts = {
  options: { label: string; position: number }[];
  multiSelect: boolean;
  minSelections: number | null;
  maxSelections: number | null;
};

// Validation runs against the persisted options: the ids exist by then, and a
// submission is matched against them. Keeping this separate from the creation
// facts means a validation caller can never type-check with id-less facts
// that would reject every ballot.
export type MultipleChoiceValidationFacts = {
  options: { id: PollOptionId; label: string; position: number }[];
  multiSelectEnabled: boolean;
  minSelections: number | null;
  maxSelections: number | null;
};

export type MultipleChoiceSubmission = {
  selectedOptionIds: readonly string[];
};

export type MultipleChoiceValidatedSubmission = {
  selectedOptionIds: readonly PollOptionId[];
};

export const MULTIPLE_CHOICE_VOTE_COPY = {
  tooFewSelections:
    "Not enough selections. This Poll asks for at least {min}, and your ballot is still here.",
  tooManySelections:
    "Too many selections. This Poll takes up to {max}, and your ballot is still here.",
} as const;

export type MultipleChoicePersistedFacts = {
  selections: { pollOptionId: PollOptionId }[];
};

export type MultipleChoiceProjectionFacts = {
  votes: { selections: { pollOptionId: PollOptionId }[] }[];
  options: { id: PollOptionId }[];
};

export type MultipleChoiceResultProjection = {
  options: { pollOptionId: PollOptionId; count: number }[];
  voterCount: number;
  selectionCount: number;
};

// The frozen AD-3 contract types `validateSubmission` against the creation
// facts generic. Validation actually consumes the persisted facts (option ids
// exist only after the creation batch assigns them), so the port is narrowed
// here rather than widening the creation facts with an optional id — the
// shared interface and contract version are untouched
// (docs/design/poll-type-contract-check.md).
export type MultipleChoiceStrategy = Omit<
  PollTypeStrategy<
    MultipleChoiceCreateInput,
    MultipleChoiceCreationFacts,
    MultipleChoiceSubmission,
    MultipleChoiceValidatedSubmission,
    MultipleChoicePersistedFacts,
    MultipleChoiceResultProjection
  >,
  "validateSubmission" | "projectResults"
> & {
  validateSubmission: (
    submission: MultipleChoiceSubmission,
    facts: MultipleChoiceValidationFacts,
  ) => Result<MultipleChoiceValidatedSubmission>;
  projectResults: (
    facts: MultipleChoiceProjectionFacts,
  ) => MultipleChoiceResultProjection;
};

export const multipleChoiceStrategy: MultipleChoiceStrategy = {
  type: "multiple_choice",
  contractVersion: POLL_TYPE_CONTRACT_VERSION,
  create: (input) => ({
    ok: true,
    value: {
      options: input.optionLabels.map((label, position) => ({
        label,
        position,
      })),
      multiSelect: input.multiSelect,
      minSelections: input.minSelections,
      maxSelections: input.maxSelections,
    },
  }),
  validateSubmission: (submission, facts) => {
    const selection = submission.selectedOptionIds;
    if (selection.length === 0) {
      const message = "Nothing's selected. Pick an option, then vote.";
      return {
        ok: false,
        error: {
          code: "selection_required",
          message,
          fieldErrors: { selectedOptionIds: message },
          reasonCodes: { selectedOptionIds: "selection_required" },
        },
      };
    }

    const knownOptionIds = new Set(facts.options.map(({ id }) => id));
    const hasOnlyKnownUniqueSelections =
      new Set(selection).size === selection.length &&
      selection.every((selectedOptionId) =>
        knownOptionIds.has(selectedOptionId as PollOptionId),
      );
    if (
      !hasOnlyKnownUniqueSelections ||
      (!facts.multiSelectEnabled && selection.length !== 1)
    ) {
      const message = "That ballot does not match this Poll.";
      return {
        ok: false,
        error: {
          code: "invalid_selection",
          message,
          fieldErrors: { selectedOptionIds: message },
          reasonCodes: { selectedOptionIds: "invalid_selection" },
        },
      };
    }

    if (facts.multiSelectEnabled) {
      const effectiveMin = facts.minSelections ?? 1;
      const effectiveMax = facts.maxSelections ?? facts.options.length;
      if (selection.length < effectiveMin) {
        const message = MULTIPLE_CHOICE_VOTE_COPY.tooFewSelections.replace(
          "{min}",
          String(effectiveMin),
        );
        return {
          ok: false,
          error: {
            code: "too_few_selections",
            message,
            fieldErrors: { selectedOptionIds: message },
            reasonCodes: { selectedOptionIds: "too_few_selections" },
          },
        };
      }
      if (selection.length > effectiveMax) {
        const message = MULTIPLE_CHOICE_VOTE_COPY.tooManySelections.replace(
          "{max}",
          String(effectiveMax),
        );
        return {
          ok: false,
          error: {
            code: "too_many_selections",
            message,
            fieldErrors: { selectedOptionIds: message },
            reasonCodes: { selectedOptionIds: "too_many_selections" },
          },
        };
      }
    }

    return {
      ok: true,
      value: {
        selectedOptionIds: selection.map(
          (selectedOptionId) => selectedOptionId as PollOptionId,
        ),
      },
    };
  },
  persistFacts: (validated) => ({
    selections: validated.selectedOptionIds.map((pollOptionId) => ({
      pollOptionId,
    })),
  }),
  projectResults: (facts) => {
    const counts = new Map<PollOptionId, number>(
      facts.options.map(({ id }) => [id, 0]),
    );
    let selectionCount = 0;
    for (const vote of facts.votes) {
      for (const { pollOptionId } of vote.selections) {
        selectionCount += 1;
        counts.set(pollOptionId, (counts.get(pollOptionId) ?? 0) + 1);
      }
    }
    return {
      options: facts.options.map(({ id }) => ({
        pollOptionId: id,
        count: counts.get(id) ?? 0,
      })),
      voterCount: facts.votes.length,
      selectionCount,
    };
  },
};
