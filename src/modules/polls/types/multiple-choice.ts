// Multiple-Choice — the first Poll Type strategy behind the AD-3 contract
// and the precedent-setter for its shape. `create` normalizes labels into
// positioned option facts; `validateSubmission`/`persistFacts` arrive with
// Story 1.5 and `projectResults` with Story 1.8.

import {
  POLL_TYPE_CONTRACT_VERSION,
  type PollTypeStrategy,
  type Result,
} from "../../../shared/application/index";
import type { PollOptionId } from "../../../shared/domain/index";

export type MultipleChoiceCreateInput = {
  optionLabels: string[];
};

// Creation facts carry no option ids — the Polls command assigns ids when it
// commits the creation batch, so nothing at creation time can reference one.
export type MultipleChoiceCreationFacts = {
  options: { label: string; position: number }[];
};

// Validation runs against the persisted options: the ids exist by then, and a
// submission is matched against them. Keeping this separate from the creation
// facts means a validation caller can never type-check with id-less facts
// that would reject every ballot.
export type MultipleChoiceValidationFacts = {
  options: { id: PollOptionId; label: string; position: number }[];
};

export type MultipleChoiceSubmission = {
  selectedOptionIds: readonly string[];
};

export type MultipleChoiceValidatedSubmission = {
  selectedOptionIds: readonly [PollOptionId];
};

export type MultipleChoicePersistedFacts = {
  selections: { pollOptionId: PollOptionId }[];
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
    MultipleChoicePersistedFacts
  >,
  "validateSubmission"
> & {
  validateSubmission: (
    submission: MultipleChoiceSubmission,
    facts: MultipleChoiceValidationFacts,
  ) => Result<MultipleChoiceValidatedSubmission>;
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

    const selectedOptionId = selection[0];
    const isKnownSingleSelection =
      selection.length === 1 &&
      facts.options.some(({ id }) => id === selectedOptionId);
    if (!isKnownSingleSelection) {
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

    return {
      ok: true,
      value: {
        selectedOptionIds: [selectedOptionId as PollOptionId],
      },
    };
  },
  persistFacts: (validated) => ({
    selections: validated.selectedOptionIds.map((pollOptionId) => ({
      pollOptionId,
    })),
  }),
};
