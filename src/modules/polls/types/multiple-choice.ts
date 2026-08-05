// Multiple-Choice — the first Poll Type strategy behind the AD-3 contract
// and the precedent-setter for its shape. `create` normalizes labels into
// positioned option facts; `validateSubmission`/`persistFacts` arrive with
// Story 1.5, projection data with Story 1.7, and its result surface with 1.8.

import {
  POLL_TYPE_CONTRACT_VERSION,
  type PollTypeExportProjection,
  type PollTypeStrategy,
  type Result,
} from "../../../shared/application/index";
import type { PollOptionId } from "../../../shared/domain/index";
import { POLL_CAPS } from "../caps";

const codePointLength = (value: string): number => [...value].length;

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

export type MultipleChoiceExportFacts = {
  multiSelectEnabled: boolean;
  minSelections: number | null;
  maxSelections: number | null;
  options: {
    label: string;
    position: number;
    count: number;
  }[];
  votes: {
    alignmentKey: number;
    createdAtMs: number;
    selections: { optionPosition: number }[];
  }[];
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
    MultipleChoiceResultProjection,
    MultipleChoiceExportFacts,
    PollTypeExportProjection
  >,
  "validateSubmission" | "projectResults" | "projectExport"
> & {
  validateSubmission: (
    submission: MultipleChoiceSubmission,
    facts: MultipleChoiceValidationFacts,
  ) => Result<MultipleChoiceValidatedSubmission>;
  projectResults: (
    facts: MultipleChoiceProjectionFacts,
  ) => MultipleChoiceResultProjection;
  projectExport: (
    facts: MultipleChoiceExportFacts,
  ) => Result<PollTypeExportProjection>;
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
          codePointLength(option.label) > POLL_CAPS.maxOptionLength ||
          !Number.isSafeInteger(option.count) ||
          option.count < 0 ||
          option.count > facts.voterCount,
      ) ||
      new Set(labels).size !== labels.length
    ) {
      return malformed();
    }
    const configuredBoundsValid = facts.multiSelectEnabled
      ? (facts.minSelections === null ||
          (Number.isSafeInteger(facts.minSelections) &&
            facts.minSelections >= 1 &&
            facts.minSelections <= options.length)) &&
        (facts.maxSelections === null ||
          (Number.isSafeInteger(facts.maxSelections) &&
            facts.maxSelections >= 1 &&
            facts.maxSelections <= options.length)) &&
        (facts.minSelections === null ||
          facts.maxSelections === null ||
          facts.minSelections <= facts.maxSelections)
      : facts.minSelections === null && facts.maxSelections === null;
    if (!configuredBoundsValid) {
      return malformed();
    }

    const recomputedCounts = new Map(options.map(({ position }) => [position, 0]));
    const voteRows: PollTypeExportProjection["votes"]["rows"][number][] = [];
    let selectionCount = 0;
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
      const selected = new Set<number>();
      const selectedOptions: (typeof options)[number][] = [];
      for (const selection of vote.selections) {
        const option = options[selection.optionPosition];
        if (
          !Number.isSafeInteger(selection.optionPosition) ||
          !option ||
          option.position !== selection.optionPosition ||
          selected.has(selection.optionPosition)
        ) {
          return malformed();
        }
        selected.add(selection.optionPosition);
        selectedOptions.push(option);
        selectionCount += 1;
        recomputedCounts.set(
          selection.optionPosition,
          (recomputedCounts.get(selection.optionPosition) ?? 0) + 1,
        );
      }
      if (selectedOptions.length === 0) {
        return malformed();
      }
      const effectiveMin = facts.multiSelectEnabled
        ? (facts.minSelections ?? 1)
        : 1;
      const effectiveMax = facts.multiSelectEnabled
        ? (facts.maxSelections ?? options.length)
        : 1;
      if (
        selectedOptions.length < effectiveMin ||
        selectedOptions.length > effectiveMax
      ) {
        return malformed();
      }
      selectedOptions.sort((left, right) => left.position - right.position);
      voteRows.push({
        alignmentKey: vote.alignmentKey,
        cells: Array.from(
          { length: effectiveMax },
          (_, index) => selectedOptions[index]?.label ?? "",
        ),
      });
    }

    if (
      selectionCount !== facts.selectionCount ||
      options.some(
        (option) => recomputedCounts.get(option.position) !== option.count,
      )
    ) {
      return malformed();
    }

    return {
      ok: true,
      value: {
        votes: {
          columns: Array.from(
            {
              length: facts.multiSelectEnabled
                ? (facts.maxSelections ?? options.length)
                : 1,
            },
            (_, index) => `SELECTION ${index + 1}`,
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
