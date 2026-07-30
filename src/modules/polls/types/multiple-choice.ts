// Multiple-Choice — the first Poll Type strategy behind the AD-3 contract
// and the precedent-setter for its shape. `create` normalizes labels into
// positioned option facts; `validateSubmission`/`persistFacts` arrive with
// Story 1.5 and `projectResults` with Story 1.8.

import {
  POLL_TYPE_CONTRACT_VERSION,
  type PollTypeStrategy,
} from "../../../shared/application/index";

export type MultipleChoiceCreateInput = {
  optionLabels: string[];
};

export type MultipleChoiceCreationFacts = {
  options: { label: string; position: number }[];
};

export const multipleChoiceStrategy: PollTypeStrategy<
  MultipleChoiceCreateInput,
  MultipleChoiceCreationFacts
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
};
