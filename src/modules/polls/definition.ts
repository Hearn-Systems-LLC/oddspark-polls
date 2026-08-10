// Shared Multiple-Choice definition validation (create + edit). Creation
// adds visibility/deadline/reference rules around this helper; Story 1.12
// edit reuses it so policy cannot drift (AD-17 / FR-5). Provider-free.

import type { Result } from "../../shared/application/index";
import { POLL_CAPS } from "./caps";
import { multipleChoiceStrategy } from "./types/multiple-choice";
import { rankedChoiceStrategy } from "./types/ranked-choice";
import {
  meetingStrategy,
  type MeetingSlotFact,
  type MeetingSlotInput,
} from "./types/meeting";
import type { RegisteredPollType } from "./types/registry";

// Voice-and-Tone catalog for definition failures — shared with create so
// edit surfaces render the same exact field copy.
export const DEFINITION_COPY = {
  questionMissing: "A Poll needs a question. Ask something.",
  questionTooLong: `That question is too long. Keep it to ${POLL_CAPS.maxQuestionLength} characters.`,
  optionsMissing: "A Poll needs options. Add at least two.",
  optionsInsufficient: "One option isn't a Poll. Add at least one more.",
  optionsTooMany: `That's too many options. Keep it to ${POLL_CAPS.maxOptions}.`,
  optionTooLong: `That option is too long. Keep it to ${POLL_CAPS.maxOptionLength} characters.`,
  optionsDuplicate: "Two options say the same thing. Make one of them different.",
  descriptionTooLong: `That description is too long. Keep it to ${POLL_CAPS.maxDescriptionLength.toLocaleString("en-US")} characters.`,
  boundsMinTooLow:
    "Min is at least 1 — a Poll someone can't vote in isn't a Poll.",
  boundsNotInteger: "Bounds must be whole numbers.",
  boundsOrder: "Min can't be more than max.",
  boundsMinTooHigh: `Min can't be more than the option count ({count}).`,
  boundsMaxTooHigh: `Max can't be more than the option count ({count}).`,
  boundsWithoutMultiSelect: "Bounds only apply when multi-select is on.",
  rowsTooMany: "That's too many rows. Clear the blank ones first.",
  commentsInvalid: "Choose whether Comments are enabled or disabled.",
  rankedBoundsInvalid:
    "Ranked Choice uses ordered preferences, not multi-select bounds.",
} as const;

export type PollDefinitionDraft = {
  question: string;
  description: string;
  options: string[];
  slots?: MeetingSlotInput[];
  timeZone?: string;
  multiSelect: string;
  minSelections: string;
  maxSelections: string;
  /** Opt-in; omitted legacy callers and forms remain disabled. */
  commentsEnabled?: string;
};

export type ValidatedPollDefinition = {
  question: string;
  description: string | null;
  options: { label: string; position: number }[];
  slots?: MeetingSlotFact[];
  multiSelect: boolean;
  minSelections: number | null;
  maxSelections: number | null;
  commentsEnabled: boolean;
};

// Voice copy says "characters" — count Unicode code points, not UTF-16.
export function codePointLength(value: string): number {
  return [...value].length;
}

// Description normalization shared by create, definition edit, and
// description-only edit: trim, blank → null, code-point cap.
export function normalizePollDescription(
  raw: string,
): Result<string | null> {
  const description = raw.trim();
  if (codePointLength(description) > POLL_CAPS.maxDescriptionLength) {
    return {
      ok: false,
      error: {
        code: "poll_validation_failed",
        message: "Fix the fields below.",
        fieldErrors: {
          description: DEFINITION_COPY.descriptionTooLong,
        },
        reasonCodes: { description: "description_too_long" },
      },
    };
  }
  return {
    ok: true,
    value: description.length > 0 ? description : null,
  };
}

export function validatePollDefinition(
  draft: PollDefinitionDraft,
  pollType: RegisteredPollType = "multiple_choice",
): Result<ValidatedPollDefinition> {
  const fieldErrors: Record<string, string> = {};
  const reasonCodes: Record<string, string> = {};
  const fail = (field: string, reason: string, message: string): void => {
    fieldErrors[field] = message;
    reasonCodes[field] = reason;
  };

  const question = draft.question.trim();
  if (question.length === 0) {
    fail("question", "question_missing", DEFINITION_COPY.questionMissing);
  } else if (codePointLength(question) > POLL_CAPS.maxQuestionLength) {
    fail("question", "question_too_long", DEFINITION_COPY.questionTooLong);
  }

  const labels = draft.options
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  if (pollType !== "meeting" && labels.length === 0) {
    fail("options", "options_missing", DEFINITION_COPY.optionsMissing);
  } else if (pollType !== "meeting" && labels.length === 1) {
    fail(
      "options",
      "options_insufficient",
      DEFINITION_COPY.optionsInsufficient,
    );
  } else if (pollType !== "meeting" && labels.length > POLL_CAPS.maxOptions) {
    fail("options", "options_too_many", DEFINITION_COPY.optionsTooMany);
  } else if (
    pollType !== "meeting" &&
    labels.some((label) => codePointLength(label) > POLL_CAPS.maxOptionLength)
  ) {
    fail("options", "option_too_long", DEFINITION_COPY.optionTooLong);
  } else if (pollType !== "meeting" && new Set(labels).size !== labels.length) {
    fail("options", "options_duplicate", DEFINITION_COPY.optionsDuplicate);
  }

  const requestedMultiSelect = draft.multiSelect === "true";
  const multiSelect = pollType === "multiple_choice" && requestedMultiSelect;
  if (
    draft.commentsEnabled !== undefined &&
    draft.commentsEnabled !== "true" &&
    draft.commentsEnabled !== "false"
  ) {
    fail(
      "commentsEnabled",
      "comments_invalid",
      DEFINITION_COPY.commentsInvalid,
    );
  }
  const rawMinSelections = draft.minSelections.trim();
  const rawMaxSelections = draft.maxSelections.trim();
  let minSelections: number | null = null;
  let maxSelections: number | null = null;

  if (pollType === "ranked_choice") {
    if (
      requestedMultiSelect ||
      rawMinSelections.length > 0 ||
      rawMaxSelections.length > 0
    ) {
      fail(
        "multiSelect",
        "ranked_bounds_invalid",
        DEFINITION_COPY.rankedBoundsInvalid,
      );
    }
  } else if (pollType === "image") {
    if (
      requestedMultiSelect ||
      rawMinSelections.length > 0 ||
      rawMaxSelections.length > 0
    ) {
      fail(
        "multiSelect",
        "image_bounds_invalid",
        "Image Polls use single-select voting, not multi-select bounds.",
      );
    }
  } else if (pollType === "meeting") {
    if (
      requestedMultiSelect ||
      rawMinSelections.length > 0 ||
      rawMaxSelections.length > 0
    ) {
      fail(
        "multiSelect",
        "meeting_bounds_invalid",
        "Meeting Polls use availability, not multi-select bounds.",
      );
    }
  } else if (!multiSelect) {
    if (rawMinSelections.length > 0 || rawMaxSelections.length > 0) {
      fail(
        "multiSelect",
        "bounds_without_multi_select",
        DEFINITION_COPY.boundsWithoutMultiSelect,
      );
    }
  } else if (fieldErrors["options"] === undefined) {
    if (rawMinSelections.length > 0) {
      const parsedMin = Number(rawMinSelections);
      if (!Number.isInteger(parsedMin)) {
        fail(
          "minSelections",
          "bounds_not_integer",
          DEFINITION_COPY.boundsNotInteger,
        );
      } else if (parsedMin < 1) {
        fail(
          "minSelections",
          "bounds_min_too_low",
          DEFINITION_COPY.boundsMinTooLow,
        );
      } else {
        minSelections = parsedMin;
      }
    }

    if (rawMaxSelections.length > 0) {
      const parsedMax = Number(rawMaxSelections);
      if (!Number.isInteger(parsedMax)) {
        fail(
          "maxSelections",
          "bounds_not_integer",
          DEFINITION_COPY.boundsNotInteger,
        );
      } else {
        maxSelections = parsedMax;
      }
    }

    const effectiveMin = minSelections ?? 1;
    const effectiveMax = maxSelections ?? labels.length;
    if (
      fieldErrors["maxSelections"] === undefined &&
      effectiveMax > labels.length
    ) {
      fail(
        "maxSelections",
        "bounds_max_too_high",
        DEFINITION_COPY.boundsMaxTooHigh.replace(
          "{count}",
          String(labels.length),
        ),
      );
    } else if (
      fieldErrors["minSelections"] === undefined &&
      effectiveMin > labels.length
    ) {
      fail(
        "minSelections",
        "bounds_min_too_high",
        DEFINITION_COPY.boundsMinTooHigh.replace(
          "{count}",
          String(labels.length),
        ),
      );
    } else if (
      fieldErrors["minSelections"] === undefined &&
      fieldErrors["maxSelections"] === undefined &&
      effectiveMin > effectiveMax
    ) {
      fail("minSelections", "bounds_order", DEFINITION_COPY.boundsOrder);
    }
  }

  const descriptionResult = normalizePollDescription(draft.description);
  if (!descriptionResult.ok) {
    fail(
      "description",
      descriptionResult.error.reasonCodes?.description ??
        "description_too_long",
      descriptionResult.error.fieldErrors?.description ??
        DEFINITION_COPY.descriptionTooLong,
    );
  }

  const meetingFacts =
    pollType === "meeting"
      ? meetingStrategy.create(
          { slots: draft.slots ?? [], timeZone: draft.timeZone ?? "" },
          { nowMs: 0 },
        )
      : null;
  if (meetingFacts && !meetingFacts.ok) {
    Object.assign(fieldErrors, meetingFacts.error.fieldErrors ?? {});
    Object.assign(reasonCodes, meetingFacts.error.reasonCodes ?? {});
  }

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      error: {
        code: "poll_validation_failed",
        message: "Fix the fields below.",
        fieldErrors,
        reasonCodes,
      },
    };
  }

  if (meetingFacts?.ok) {
    return {
      ok: true,
      value: {
        question,
        description: descriptionResult.ok ? descriptionResult.value : null,
        options: [],
        slots: meetingFacts.value.slots,
        multiSelect: false,
        minSelections: null,
        maxSelections: null,
        commentsEnabled: draft.commentsEnabled === "true",
      },
    };
  }

  const facts =
    pollType === "ranked_choice"
      ? rankedChoiceStrategy.create({ optionLabels: labels }, { nowMs: 0 })
      : multipleChoiceStrategy.create(
          {
            optionLabels: labels,
            multiSelect: pollType === "image" ? false : multiSelect,
            minSelections: pollType === "image" ? null : minSelections,
            maxSelections: pollType === "image" ? null : maxSelections,
          },
          { nowMs: 0 },
        );
  if (!facts.ok) {
    return facts;
  }

  return {
    ok: true,
    value: {
      question,
      description: descriptionResult.ok ? descriptionResult.value : null,
      options: facts.value.options,
      multiSelect: facts.value.multiSelect,
      minSelections: facts.value.minSelections,
      maxSelections: facts.value.maxSelections,
      commentsEnabled: draft.commentsEnabled === "true",
    },
  };
}
