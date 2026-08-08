// First-class Poll Type registry. Unknown/future types fail closed; callers
// resolve the authoritative stored Poll Type before asking for a strategy.

import type { PollType } from "../../../shared/domain/index";
import type {
  MultipleChoiceVoteSubmission,
  VotingPollTypeStrategy,
} from "../../voting/index";
import { imageStrategy } from "./image";
import { multipleChoiceStrategy } from "./multiple-choice";
import {
  rankedChoiceStrategy,
  type RankedChoiceVoteSubmission,
} from "./ranked-choice";

export const pollTypeStrategies = {
  multiple_choice: multipleChoiceStrategy,
  ranked_choice: rankedChoiceStrategy,
  image: imageStrategy,
} as const;

export type RegisteredPollType = keyof typeof pollTypeStrategies;

export function isRegisteredPollType(
  pollType: string,
): pollType is RegisteredPollType {
  return Object.hasOwn(pollTypeStrategies, pollType);
}

export function pollTypeStrategyFor(pollType: PollType) {
  return isRegisteredPollType(pollType)
    ? pollTypeStrategies[pollType]
    : null;
}

export function votingStrategyFor(
  pollType: PollType,
): VotingPollTypeStrategy | null {
  if (pollType === "multiple_choice" || pollType === "image") {
    return {
      type: "multiple_choice",
      validateSubmission: (submission, facts) => {
        if (
          submission.kind !== undefined &&
          submission.kind !== "multiple_choice"
        ) {
          return {
            ok: false,
            error: {
              code: "invalid_selection",
              message: "That ballot does not match this Poll.",
            },
          };
        }
        const result = multipleChoiceStrategy.validateSubmission(
          submission as MultipleChoiceVoteSubmission,
          facts,
        );
        return result.ok
          ? {
              ok: true,
              value: {
                kind: "multiple_choice" as const,
                selectedOptionIds: result.value.selectedOptionIds,
              },
            }
          : result;
      },
      persistFacts: (validated) => {
        if (validated.kind !== "multiple_choice") {
          throw new Error("Poll Type strategy mismatch");
        }
        return {
          kind: "multiple_choice",
          ...multipleChoiceStrategy.persistFacts!(validated),
        };
      },
    };
  }
  if (pollType === "ranked_choice") {
    return {
      type: "ranked_choice",
      validateSubmission: (submission, facts) => {
        if (submission.kind !== "ranked_choice") {
          return {
            ok: false,
            error: {
              code: "invalid_ranking",
              message: "That ranking does not match this Poll.",
            },
          };
        }
        return rankedChoiceStrategy.validateSubmission(
          submission as RankedChoiceVoteSubmission,
          facts,
        );
      },
      persistFacts: (validated) => {
        if (validated.kind !== "ranked_choice") {
          throw new Error("Poll Type strategy mismatch");
        }
        return {
          kind: "ranked_choice",
          ...rankedChoiceStrategy.persistFacts!(validated),
        };
      },
    };
  }
  return null;
}
