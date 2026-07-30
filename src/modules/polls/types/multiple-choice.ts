// Multiple-Choice — the first Poll Type strategy behind the AD-3 contract
// and the precedent-setter for its shape. `create` normalizes labels into
// positioned option facts; `validateSubmission`/`persistFacts` arrive with
// Story 1.5 and `projectResults` with Story 1.8.

import {
  POLL_TYPE_CONTRACT_VERSION,
  type PollTypeStrategy,
} from "../../../shared/application/index";
import type { PollOptionId } from "../../../shared/domain/index";

export type MultipleChoiceCreateInput = {
  optionLabels: string[];
};

export type MultipleChoiceCreationFacts = {
  options: { id?: PollOptionId; label: string; position: number }[];
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

export const multipleChoiceStrategy: PollTypeStrategy<
  MultipleChoiceCreateInput,
  MultipleChoiceCreationFacts,
  MultipleChoiceSubmission,
  MultipleChoiceValidatedSubmission,
  MultipleChoicePersistedFacts
> = {
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
