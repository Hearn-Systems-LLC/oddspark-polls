// Image Poll — AD-3 contract v5 strategy. Voting and tabulation are exactly
// Multiple-Choice (FR-11), so submission validation, fact persistence, result
// projection, and export projection all delegate to the MC implementations.
// `create` extends MC with per-option media facts (media id, required alt
// text, optional caption).

import {
  POLL_TYPE_CONTRACT_VERSION,
  type PollTypeExportProjection,
  type PollTypeStrategy,
  type Result,
} from "../../../shared/application/index";
import type { PollOptionId } from "../../../shared/domain/index";
import {
  multipleChoiceStrategy,
  type MultipleChoiceCreationFacts,
  type MultipleChoiceExportFacts,
  type MultipleChoicePersistedFacts,
  type MultipleChoiceProjectionFacts,
  type MultipleChoiceResultProjection,
  type MultipleChoiceSubmission,
  type MultipleChoiceValidatedSubmission,
  type MultipleChoiceValidationFacts,
} from "./multiple-choice";

export type ImageOptionMediaInput = {
  mediaId: string;
  altText: string;
  caption: string;
};

export type ImageCreateInput = {
  optionLabels: string[];
  media: ImageOptionMediaInput[];
};

export type ImageOptionMediaFact = {
  mediaId: string;
  altText: string;
  caption: string | null;
};

export type ImageCreationFacts = MultipleChoiceCreationFacts & {
  media: ImageOptionMediaFact[];
};

export const IMAGE_DEFINITION_COPY = {
  mediaCountMismatch:
    "Each option needs exactly one image. Check that every option has a matching upload.",
  altTextMissing:
    "This image needs alt text before the Poll can publish. Describe what a Voter should know.",
  mediaIdMissing:
    "An image upload is missing. Try uploading it again.",
} as const;

const codePointLength = (value: string): number => [...value].length;

export type ImageStrategy = Omit<
  PollTypeStrategy<
    ImageCreateInput,
    ImageCreationFacts,
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

export const imageStrategy: ImageStrategy = {
  type: "image",
  contractVersion: POLL_TYPE_CONTRACT_VERSION,
  create: (input) => {
    if (input.media.length !== input.optionLabels.length) {
      return {
        ok: false,
        error: {
          code: "poll_validation_failed",
          message: "Fix the fields below.",
          fieldErrors: { media: IMAGE_DEFINITION_COPY.mediaCountMismatch },
          reasonCodes: { media: "media_count_mismatch" },
        },
      };
    }

    const mediaFacts: ImageOptionMediaFact[] = [];
    for (let i = 0; i < input.media.length; i++) {
      const entry = input.media[i]!;
      const trimmedAlt = entry.altText.trim();
      if (trimmedAlt.length === 0) {
        return {
          ok: false,
          error: {
            code: "poll_validation_failed",
            message: "Fix the fields below.",
            fieldErrors: {
              [`media[${i}].altText`]: IMAGE_DEFINITION_COPY.altTextMissing,
            },
            reasonCodes: {
              [`media[${i}].altText`]: "alt_text_missing",
            },
          },
        };
      }
      const trimmedId = entry.mediaId.trim();
      if (trimmedId.length === 0) {
        return {
          ok: false,
          error: {
            code: "poll_validation_failed",
            message: "Fix the fields below.",
            fieldErrors: {
              [`media[${i}].mediaId`]: IMAGE_DEFINITION_COPY.mediaIdMissing,
            },
            reasonCodes: {
              [`media[${i}].mediaId`]: "media_id_missing",
            },
          },
        };
      }
      const trimmedCaption = entry.caption.trim();
      mediaFacts.push({
        mediaId: trimmedId,
        altText: trimmedAlt,
        caption: trimmedCaption.length > 0 ? trimmedCaption : null,
      });
    }

    const mcResult = multipleChoiceStrategy.create(
      {
        optionLabels: input.optionLabels,
        multiSelect: false,
        minSelections: null,
        maxSelections: null,
      },
      { nowMs: 0 },
    );
    if (!mcResult.ok) {
      return mcResult;
    }

    return {
      ok: true,
      value: {
        ...mcResult.value,
        media: mediaFacts,
      },
    };
  },
  validateSubmission: (submission, facts) =>
    multipleChoiceStrategy.validateSubmission(submission, facts),
  persistFacts: (validated) => multipleChoiceStrategy.persistFacts!(validated),
  projectResults: (facts) => multipleChoiceStrategy.projectResults!(facts),
  projectExport: (facts) => multipleChoiceStrategy.projectExport(facts),
};
