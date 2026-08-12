/** Module boundary placeholder — populated by later stories. */
// Voting application module (AD-19). CastVote is the sole coordinator for
// accepted vote facts. It is provider-free: adapters supply reads, hashing,
// digests, IDs, and the one constrained persistence batch.

import {
  incrementRepresentationVersion,
  type ApplicationError,
  type HumanChallengeProof,
  type RepresentationVersionIncrement,
  type Result,
} from "../../shared/application/index";
import {
  effectivePollStatus,
  type AvailabilityState,
  type PollId,
  type PollOptionId,
  type PollType,
  type VoterCodeId,
} from "../../shared/domain/index";
import { MULTIPLE_CHOICE_VOTE_COPY } from "../polls/types/multiple-choice";
import type { RankedPreferenceInput } from "../polls/types/ranked-choice";
import {
  COMMENT_COPY,
  makeVoteCommentContribution,
  normalizeComment,
  type CanonicalComment,
  type CommentDraft,
  type VoteCommentContribution,
} from "../comments/index";
import {
  asVoterClaimDigest,
  type RevisionCapabilityDigest,
  type VoterClaimCheckKind,
  type VoterClaimDigest,
} from "./ip-address";

import {
  normalizeVoterCodeInput,
  resolveVoterCodeAdmission,
  VOTER_CODE_ADMISSION_COPY,
  type VoterCodeRedemptionContribution,
} from "./voter-codes";

export {
  asVoteRateLimitDigest,
  asRevisionCapabilityDigest,
  asVoterClaimDigest,
  isVoteDigestPurpose,
  isVoteRateLimitDigest,
  isVoterClaimCheckKind,
  isVoterClaimDigest,
  normalizeIpIdentity,
  type IpIdentityResult,
  type NormalizedIpIdentity,
  type VoteDigestPurpose,
  type VoteRateLimitDigest,
  type RevisionCapabilityDigest,
  type VoterClaimCheckKind,
  type VoterClaimDigest,
} from "./ip-address";

export const VOTE_COPY = {
  counted: "Counted.",
  countedLive: "Results are live, updating as they arrive.",
  countedAfterClose:
    "Results open when the Poll closes — {deadline}. You'll find out when everyone else does.",
  countedCreatorOnly: "These results go to the Creator only.",
  alreadyVoted:
    "You've already voted here. Enthusiasm noted; the Tally is unchanged.",
  alreadyVotedIp:
    "Someone on this connection already voted. The Creator turned on one-vote-per-network, and it can't tell roommates apart. If that's you, ask them to send you the results instead.",
  pollClosed:
    "This Poll closed while you were deciding — {when}. Your Vote wasn't recorded.",
  closedOnGet: "This Poll closed {when}.",
  retry:
    "That didn't land. The Vote wasn't recorded and your ballot is still here, exactly as you left it. Try again — and if it keeps failing, the Poll will still be here in a minute.",
  rateLimited:
    "Too many Votes from here, too quickly. Give it a minute. If you're a person, this shouldn't have happened, and we're sorry it did.",
  offline:
    "No connection. Your ballot is safe on this page; nothing has been sent yet.",
  selectionRequired: "Nothing's selected. Pick an option, then vote.",
  tooFewSelections: MULTIPLE_CHOICE_VOTE_COPY.tooFewSelections,
  tooManySelections: MULTIPLE_CHOICE_VOTE_COPY.tooManySelections,
  pollDeleted: "This Poll no longer exists.",
  pollDefinitionChanged:
    "This Poll changed while you were deciding. Your Vote wasn't recorded — review the options and try again.",
  idempotencyConflict:
    "Your earlier Vote stands — this change wasn't recorded.",
  captchaFailed:
    "The human check didn't pass. Try it again — it's usually just a fluke.",
} as const;

export type { HumanChallengeProof };

export class AlreadyVotedError extends Error {
  readonly checkKind: VoterClaimCheckKind;

  constructor(checkKind: VoterClaimCheckKind) {
    super("voter claim already exists");
    this.name = "AlreadyVotedError";
    this.checkKind = checkKind;
  }
}

export class SubmissionReplayError extends Error {
  constructor() {
    super("submission id already exists");
    this.name = "SubmissionReplayError";
  }
}

export class PollClosedError extends Error {
  constructor() {
    super("poll is closed");
    this.name = "PollClosedError";
  }
}

export class PollGoneError extends Error {
  constructor() {
    super("poll no longer exists");
    this.name = "PollGoneError";
  }
}

// Option FK race after a definition edit: the Poll still exists but the
// selected option IDs do not. Distinct from PollGone so the delivery boundary
// never renders a live Poll as deleted (Story 1.12).
export class PollDefinitionChangedError extends Error {
  constructor() {
    super("poll definition changed");
    this.name = "PollDefinitionChangedError";
  }
}

export class CommentsDisabledError extends Error {
  constructor() {
    super("comments_disabled");
    this.name = "CommentsDisabledError";
  }
}

export type VotingPollSnapshot = {
  id: PollId;
  pollType: PollType;
  options: {
    id: PollOptionId;
    label: string;
    position: number;
  }[];
  slots?: { id: string; position: number }[];
  sessionChecksEnabled: boolean;
  ipChecksEnabled: boolean;
  /** Authoritative CAPTCHA policy from the fresh Poll snapshot (Story 2.3). */
  captchaEnabled: boolean;
  voterCodesEnabled: boolean;
  commentsEnabled: boolean;
  multiSelectEnabled: boolean;
  minSelections: number | null;
  maxSelections: number | null;
  deadlineMs: number | null;
  closedAtMs: number | null;
};

export type MultipleChoiceVoteSubmission = {
  kind?: "multiple_choice";
  selectedOptionIds: readonly string[];
  rankedPreferences?: never;
};

export type RankedChoiceVoteSubmission = {
  kind: "ranked_choice";
  selectedOptionIds: readonly string[];
  rankedPreferences: readonly RankedPreferenceInput[];
};

export type MeetingVoteSubmission = {
  kind: "meeting";
  selectedOptionIds: readonly string[];
  displayName: string;
  availability: readonly { slotId: string; state: string; position: number }[];
};

export type VoteSubmission =
  | MultipleChoiceVoteSubmission
  | RankedChoiceVoteSubmission
  | MeetingVoteSubmission;

export type MultipleChoiceValidatedVoteSubmission = {
  kind?: "multiple_choice";
  selectedOptionIds: readonly PollOptionId[];
  rankedPreferences?: never;
};

export type RankedChoiceValidatedVoteSubmission = {
  kind: "ranked_choice";
  selectedOptionIds: readonly PollOptionId[];
  rankedPreferences: readonly {
    pollOptionId: PollOptionId;
    rank: number;
  }[];
};

export type ValidatedVoteSubmission =
  | MultipleChoiceValidatedVoteSubmission
  | RankedChoiceValidatedVoteSubmission
  | { kind: "meeting"; selectedOptionIds: readonly PollOptionId[]; displayName: string; availability: { meetingSlotId: string; state: AvailabilityState; position: number }[] };

export type PersistedVoteFacts =
  | {
      kind?: "multiple_choice";
      selections: { pollOptionId: PollOptionId }[];
      preferences?: never;
    }
  | {
      kind: "ranked_choice";
      preferences: { pollOptionId: PollOptionId; rank: number }[];
      selections?: never;
    }
  | {
      kind: "meeting";
      displayName: string;
      availability: { meetingSlotId: string; state: AvailabilityState; position: number }[];
    };

export type VotingPollTypeStrategy = {
  readonly type?: "multiple_choice" | "ranked_choice" | "meeting";
  validateSubmission: (
    submission: VoteSubmission,
    facts: Pick<
      VotingPollSnapshot,
      | "options"
      | "multiSelectEnabled"
      | "minSelections"
      | "maxSelections"
    > & { slots?: readonly { id: string; position: number }[] },
  ) => Result<ValidatedVoteSubmission>;
  persistFacts: (validated: ValidatedVoteSubmission) => PersistedVoteFacts;
};

export type VoteSelectionContribution = {
  kind: "vote_selection";
  voteId: string;
  pollOptionId: PollOptionId;
};

export type RankedPreferenceContribution = {
  kind: "ranked_preference";
  voteId: string;
  pollOptionId: PollOptionId;
  rank: number;
};

export type MeetingAvailabilityContribution = { kind: "meeting_availability"; voteId: string; meetingSlotId: string; availability: AvailabilityState };
export type MeetingResponseContribution = { kind: "meeting_response"; voteId: string; displayName: string; revisionCapabilityDigest: string };

export type StoredMeetingResponse = {
  voteId: string;
  displayName: string;
  availability: { meetingSlotId: string; availability: AvailabilityState }[];
};

export type ReviseMeetingResponseBatch = {
  pollId: PollId;
  voteId: string;
  displayName: string;
  availability: { meetingSlotId: string; availability: AvailabilityState }[];
  updatedAtMs: number;
};

export type VoterClaimContribution = {
  kind: "voter_claim";
  pollId: PollId;
  checkKind: VoterClaimCheckKind;
  digest: VoterClaimDigest;
  voteId: string;
  createdAtMs: number;
};

export type VoteExtensionContribution = {
  kind: `extension:${string}`;
  payload: Readonly<Record<string, unknown>>;
};

export type VotePersistenceContribution =
  | VoteSelectionContribution
  | RankedPreferenceContribution
  | VoterClaimContribution
  | VoteCommentContribution
  | MeetingAvailabilityContribution
  | MeetingResponseContribution
  | VoteExtensionContribution
  | VoterCodeRedemptionContribution;

export type VotePersistenceBatch = {
  vote: {
    id: string;
    pollId: PollId;
    submissionId: string;
    payloadHash: string;
    createdAtMs: number;
  };
  contributions: VotePersistenceContribution[];
  representationVersion: RepresentationVersionIncrement;
};

export type StoredVoteOutcome = {
  voteId: string;
  payloadHash: string;
  createdAtMs: number;
};

export type VoteFactContributorContext = {
  poll: VotingPollSnapshot;
  voteId: string;
  nowMs: number;
};

export type VoteFactContributor = (
  context: VoteFactContributorContext,
) =>
  | readonly VoteExtensionContribution[]
  | Promise<readonly VoteExtensionContribution[]>;

export type CastVoteDeps = {
  findPoll: (pollId: PollId) => Promise<VotingPollSnapshot | null>;
  findVoteBySubmission: (
    pollId: PollId,
    submissionId: string,
  ) => Promise<StoredVoteOutcome | null>;
  /**
   * After an option-FK failure: return true when every selected option still
   * exists on the Poll. Used to distinguish poll_definition_changed from a
   * generic vote failure (Story 1.12).
   */
  optionsStillReachable?: (
    pollId: PollId,
    optionIds: readonly PollOptionId[],
  ) => Promise<boolean>;
  strategyFor: (pollType: PollType) => VotingPollTypeStrategy | null;
  createDigest: (input: {
    pollId: PollId;
    checkKind: VoterClaimCheckKind;
    token: string;
  }) => Promise<VoterClaimDigest>;
  hashPayload: (payload: string) => Promise<string>;
  persistVote: (batch: VotePersistenceBatch) => Promise<void>;
  lookupVoterCode?: (pollId: PollId, canonicalCode: string) => Promise<{ codeId: VoterCodeId; redeemed: boolean } | null>;
  generateId: () => string;
  nowMs: () => number;
  contributors?: readonly VoteFactContributor[];
};

type CastVoteInputBase = {
  pollId: PollId;
  submissionId: string;
  comment?: CommentDraft;
  browserToken: string | null;
  voterCode: string;
  /**
   * Prepared IP claim digest from the inbound delivery boundary, or null when
   * identity is unavailable. CastVote's authoritative Poll snapshot decides
   * whether the claim is required — the route does not.
   */
  ipDigest: VoterClaimDigest | null;
  /**
   * Provider-neutral human-challenge proof from the outbound adapter. Raw
   * tokens, Siteverify DTOs, and provider error codes never cross this
   * boundary. CastVote's authoritative Poll snapshot decides whether proof
   * is required.
   */
  humanChallenge: HumanChallengeProof;
};

export type CastVoteInput = CastVoteInputBase &
  (
    | {
        /** Omitted preserves the pre-Ranked Multiple-Choice transport. */
        pollType?: "multiple_choice";
        selectedOptionIds: readonly string[];
        rankedPreferences?: never;
      }
    | {
        pollType: "ranked_choice";
        /** Kept explicit and empty so legacy delivery code cannot infer rank. */
        selectedOptionIds: readonly string[];
        rankedPreferences: readonly RankedPreferenceInput[];
      }
    | {
        pollType: "meeting";
        displayName: string;
        availability: readonly { slotId: string; state: string; position: number }[];
        revisionCapabilityDigest: string;
        selectedOptionIds: readonly string[];
        rankedPreferences?: never;
      }
  );

export type CastVoteOutcome = {
  acceptedAtMs: number;
  existing: boolean;
  pollId: PollId;
  voteId: string;
};

export type ReviseVoteInput = {
  pollId: PollId;
  revisionCapability: string;
  displayName: string;
  availability: readonly { slotId: string; state: string; position: number }[];
  submissionId: string;
};

export type ReviseVoteDeps = {
  findPoll: (pollId: PollId) => Promise<VotingPollSnapshot | null>;
  findMeetingResponseByRevisionDigest: (pollId: PollId, digest: RevisionCapabilityDigest) => Promise<StoredMeetingResponse | null>;
  createDigest: (input: { pollId: PollId; checkKind: "revision"; token: string }) => Promise<RevisionCapabilityDigest>;
  reviseMeetingResponse: (batch: ReviseMeetingResponseBatch) => Promise<void>;
  strategyFor: (pollType: PollType) => VotingPollTypeStrategy | null;
  nowMs: () => number;
};

export async function reviseVote(
  deps: ReviseVoteDeps,
  input: ReviseVoteInput,
): Promise<Result<{ pollId: PollId; voteId: string; acceptedAtMs: number }>> {
  try {
    const poll = await deps.findPoll(input.pollId);
    if (!poll) return failure("poll_deleted", VOTE_COPY.pollDeleted);
    const nowMs = deps.nowMs();
    if (effectivePollStatus(poll, nowMs) === "closed") {
      return failure("poll_closed", VOTE_COPY.pollClosed, { closedAtMs: poll.closedAtMs ?? poll.deadlineMs ?? nowMs });
    }
    const digest = await deps.createDigest({ pollId: input.pollId, checkKind: "revision", token: input.revisionCapability });
    const stored = await deps.findMeetingResponseByRevisionDigest(input.pollId, digest);
    if (!stored) return failure("revision_capability_invalid", VOTE_COPY.retry);
    const strategy = deps.strategyFor("meeting");
    if (!strategy) return failure("vote_failed", VOTE_COPY.retry);
    const validated = strategy.validateSubmission(
      { kind: "meeting", selectedOptionIds: [], displayName: input.displayName, availability: input.availability },
      { options: poll.options, slots: poll.slots ?? [], multiSelectEnabled: false, minSelections: null, maxSelections: null },
    );
    if (!validated.ok) return failure(validated.error.code, validated.error.message, {
      ...(validated.error.fieldErrors ? { fieldErrors: validated.error.fieldErrors } : {}),
      ...(validated.error.reasonCodes ? { reasonCodes: validated.error.reasonCodes } : {}),
    });
    if (validated.value.kind !== "meeting") return failure("vote_failed", VOTE_COPY.retry);
    await deps.reviseMeetingResponse({
      pollId: input.pollId,
      voteId: stored.voteId,
      displayName: validated.value.displayName,
      availability: validated.value.availability.map((entry) => ({ meetingSlotId: entry.meetingSlotId, availability: entry.state })),
      updatedAtMs: nowMs,
    });
    return { ok: true, value: { pollId: input.pollId, voteId: stored.voteId, acceptedAtMs: nowMs } };
  } catch (error) {
    if (error instanceof PollClosedError) return failure("poll_closed", VOTE_COPY.pollClosed, { closedAtMs: deps.nowMs() });
    if (error instanceof PollDefinitionChangedError) return failure("poll_definition_changed", VOTE_COPY.pollDefinitionChanged);
    if (error instanceof PollGoneError) return failure("poll_deleted", VOTE_COPY.pollDeleted);
    return failure("vote_failed", VOTE_COPY.retry);
  }
}

export type VoteApplicationError = ApplicationError & {
  closedAtMs?: number;
};

export function normalizeVotePayload(
  pollId: PollId,
  selectedOptionIds: readonly string[],
  comment: CanonicalComment | null = null,
): string {
  const legacy = {
    pollId,
    selectedOptionIds: [...selectedOptionIds].sort(),
  };
  // Do not add even a null property on the no-Comment path: hashes accepted
  // before Story 4.1 must remain byte-for-byte replay-compatible.
  return JSON.stringify(
    comment === null ? legacy : { ...legacy, comment },
  );
}

export function normalizeRankedVotePayload(
  pollId: PollId,
  rankedPreferences: readonly RankedPreferenceInput[],
  comment: CanonicalComment | null = null,
): string {
  // The canonical payload is the byte-compat idempotency contract boundary;
  // refuse to canonicalize a structurally invalid Ballot (non-integer,
  // duplicate, or non-contiguous ranks) instead of silently hashing garbage.
  const ordered = [...rankedPreferences].sort(
    (left, right) => left.rank - right.rank,
  );
  const seenOptions = new Set<string>();
  const structurallyValid =
    ordered.length > 0 &&
    ordered.every(
      (preference, index) =>
        Number.isSafeInteger(preference.rank) &&
        preference.rank === index + 1 &&
        preference.optionId.length > 0 &&
        !seenOptions.has(preference.optionId) &&
        (seenOptions.add(preference.optionId), true),
    );
  if (!structurallyValid) {
    throw new Error("invalid ranked ballot payload");
  }
  const ranked = {
    pollId,
    pollType: "ranked_choice" as const,
    rankedPreferences: ordered.map(({ optionId, rank }) => ({ optionId, rank })),
  };
  return JSON.stringify(
    comment === null ? ranked : { ...ranked, comment },
  );
}

export function normalizeMeetingVotePayload(
  pollId: PollId,
  displayName: string,
  availability: readonly { slotId: string; state: string; position: number }[],
  comment: CanonicalComment | null = null,
): string {
  const base = {
    pollId,
    pollType: "meeting" as const,
    displayName: displayName.trim(),
    availability: [...availability]
      .sort((a, b) => a.position - b.position)
      .map(({ slotId, state }) => ({ slotId, state })),
  };
  return JSON.stringify(
    comment === null ? base : { ...base, comment },
  );
}

function acceptedReplay(
  pollId: PollId,
  stored: StoredVoteOutcome,
): Result<CastVoteOutcome> {
  return {
    ok: true,
    value: {
      acceptedAtMs: stored.createdAtMs,
      existing: true,
      pollId,
      voteId: stored.voteId,
    },
  };
}

function failure(
  code: string,
  message: string,
  extra: Partial<
    Pick<VoteApplicationError, "closedAtMs" | "fieldErrors" | "reasonCodes">
  > = {},
): Result<CastVoteOutcome> {
  return {
    ok: false,
    error: {
      code,
      message,
      ...extra,
    },
  };
}

function adjudicateReplay(
  pollId: PollId,
  payloadHash: string,
  stored: StoredVoteOutcome,
): Result<CastVoteOutcome> {
  if (stored.payloadHash === payloadHash) {
    return acceptedReplay(pollId, stored);
  }
  // A payload mismatch is a permanent conflict, not a transient failure —
  // the stored vote stands and retrying the same submission can never land.
  return failure("idempotency_conflict", VOTE_COPY.idempotencyConflict);
}

export async function castVote(
  deps: CastVoteDeps,
  input: CastVoteInput,
): Promise<Result<CastVoteOutcome>> {
  let comment: CanonicalComment | null;
  try {
    const normalizedComment = normalizeComment(
      input.comment ?? { body: "", displayName: "" },
    );
    if (!normalizedComment.ok) {
      // An invalid payload cannot be an exact replay of an accepted Vote.
      // Still adjudicate a reused submission ID as a permanent conflict so
      // the original winner remains authoritative (and downstream security
      // work stays skipped by the delivery preflight).
      try {
        const stored = await deps.findVoteBySubmission(
          input.pollId,
          input.submissionId,
        );
        if (stored) {
          return failure(
            "idempotency_conflict",
            VOTE_COPY.idempotencyConflict,
          );
        }
      } catch {
        return failure("vote_failed", VOTE_COPY.retry);
      }
      let currentPoll: VotingPollSnapshot | null;
      try {
        currentPoll = await deps.findPoll(input.pollId);
      } catch {
        return failure("vote_failed", VOTE_COPY.retry);
      }
      if (!currentPoll) {
        return failure("poll_deleted", VOTE_COPY.pollDeleted);
      }
      if (!currentPoll.commentsEnabled) {
        return failure("comments_disabled", COMMENT_COPY.disabled, {
          fieldErrors: { comment: COMMENT_COPY.disabled },
          reasonCodes: { comment: "comments_disabled" },
        });
      }
      return failure(
        normalizedComment.error.code,
        normalizedComment.error.message,
        {
          fieldErrors: normalizedComment.error.fieldErrors,
          reasonCodes: normalizedComment.error.reasonCodes,
        },
      );
    }
    comment = normalizedComment.value;
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }
  let normalizedPayload: string;
  try {
    normalizedPayload =
      input.pollType === "meeting"
        ? normalizeMeetingVotePayload(
            input.pollId,
            input.displayName,
            input.availability,
            comment,
          )
      : input.pollType === "ranked_choice"
        ? normalizeRankedVotePayload(
            input.pollId,
            input.rankedPreferences,
            comment,
          )
        : normalizeVotePayload(
            input.pollId,
            input.selectedOptionIds,
            comment,
          );
  } catch {
    // Structurally invalid ranked preferences (gaps, duplicates, empty)
    // must fail closed as a permanent ballot rejection, never a transient
    // 500. Strategy validation would return the same code if normalize ran
    // after it; normalize is first because the payload hash needs the
    // canonical form for idempotent replays of already-valid ballots.
    if (input.pollType === "ranked_choice") {
      return failure(
        "invalid_ranking",
        "That ranking does not match this Poll.",
      );
    }
    return failure("vote_failed", VOTE_COPY.retry);
  }

  let payloadHash: string;
  let existing: StoredVoteOutcome | null;
  try {
    payloadHash = await deps.hashPayload(normalizedPayload);
    existing = await deps.findVoteBySubmission(
      input.pollId,
      input.submissionId,
    );
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }

  if (existing) {
    return adjudicateReplay(input.pollId, payloadHash, existing);
  }

  let poll: VotingPollSnapshot | null;
  try {
    poll = await deps.findPoll(input.pollId);
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }
  if (!poll) {
    return failure("poll_deleted", VOTE_COPY.pollDeleted);
  }
  if (comment !== null && !poll.commentsEnabled) {
    return failure("comments_disabled", COMMENT_COPY.disabled, {
      fieldErrors: { comment: COMMENT_COPY.disabled },
      reasonCodes: { comment: "comments_disabled" },
    });
  }

  let nowMs: number;
  try {
    nowMs = deps.nowMs();
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }
  if (effectivePollStatus(poll, nowMs) === "closed") {
    return failure("poll_closed", VOTE_COPY.pollClosed, {
      closedAtMs: poll.closedAtMs ?? poll.deadlineMs ?? nowMs,
    });
  }

  // Strategy ports join the module's error discipline: a throwing strategy
  // (or a throwing strategyFor) degrades to a transient vote_failed Result,
  // never a rejected promise.
  let strategy: VotingPollTypeStrategy | null;
  try {
    strategy = deps.strategyFor(poll.pollType);
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }
  if (!strategy) {
    return failure("vote_failed", VOTE_COPY.retry);
  }
  let validated: Result<ValidatedVoteSubmission>;
  try {
    const submission: VoteSubmission =
      input.pollType === "meeting"
        ? { kind: "meeting", selectedOptionIds: [], displayName: input.displayName, availability: input.availability }
      : input.pollType === "ranked_choice"
        ? {
            kind: "ranked_choice",
            selectedOptionIds: input.selectedOptionIds,
            rankedPreferences: input.rankedPreferences,
          }
        : {
            selectedOptionIds: input.selectedOptionIds,
          };
    const validationFacts = {
        options: poll.options,
        multiSelectEnabled: poll.multiSelectEnabled,
        minSelections: poll.minSelections,
        maxSelections: poll.maxSelections,
      };
    validated = strategy.validateSubmission(
      submission,
      poll.pollType === "meeting"
        ? { ...validationFacts, slots: poll.slots ?? [] }
        : validationFacts,
    );
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }
  if (!validated.ok) {
    // The strategy's message and field errors describe a ballot that can
    // never succeed — pass them through instead of transient-retry copy.
    // A blank strategy message is a defect, not voter-facing copy: fall back
    // to the retry idiom rather than render nothing.
    const strategyError = validated.error;
    const detail = {
      ...(strategyError.fieldErrors !== undefined
        ? { fieldErrors: strategyError.fieldErrors }
        : {}),
      ...(strategyError.reasonCodes !== undefined
        ? { reasonCodes: strategyError.reasonCodes }
        : {}),
    };
    if (strategyError.code === "selection_required") {
      return failure("selection_required", VOTE_COPY.selectionRequired, detail);
    }
    if (strategyError.code === "ranking_required") {
      return failure("ranking_required", strategyError.message, detail);
    }
    if (strategyError.code === "invalid_ranking") {
      return failure("invalid_ranking", strategyError.message, detail);
    }
    if (strategyError.code.startsWith("availability_") || strategyError.code.startsWith("display_name_")) return failure(strategyError.code, strategyError.message, detail);
    const message =
      strategyError.message.trim().length > 0
        ? strategyError.message
        : VOTE_COPY.retry;
    if (
      strategyError.code === "too_few_selections" ||
      strategyError.code === "too_many_selections"
    ) {
      return failure(strategyError.code, message, detail);
    }
    return failure("invalid_selection", message, detail);
  }

  // Session claim: required only when the authoritative snapshot enables it.
  let sessionDigest: VoterClaimDigest | null = null;
  if (poll.sessionChecksEnabled) {
    if (!input.browserToken) {
      return failure("session_token_missing", VOTE_COPY.retry);
    }
    try {
      const raw = await deps.createDigest({
        pollId: poll.id,
        checkKind: "session",
        token: input.browserToken,
      });
      sessionDigest = asVoterClaimDigest(raw);
      if (sessionDigest === null) {
        return failure("vote_failed", VOTE_COPY.retry);
      }
    } catch {
      return failure("vote_failed", VOTE_COPY.retry);
    }
  }

  // IP claim: required only when the authoritative snapshot enables it. A
  // missing/malformed digest is infrastructure `ip_check_unavailable`, never a
  // voter-correctable rejection. With IP off, a prepared digest is ignored.
  let ipDigest: VoterClaimDigest | null = null;
  if (poll.ipChecksEnabled) {
    if (input.ipDigest === null) {
      return failure("ip_check_unavailable", VOTE_COPY.retry);
    }
    ipDigest = asVoterClaimDigest(input.ipDigest);
    if (ipDigest === null) {
      return failure("ip_check_unavailable", VOTE_COPY.retry);
    }
  }

  // CAPTCHA: required only when the authoritative snapshot enables it. Fail
  // closed on failed/not_attempted; with CAPTCHA off, ignore any proof value
  // (including a stale failed verification from an on→off race).
  if (poll.captchaEnabled) {
    if (input.humanChallenge !== "passed") {
      return failure("captcha_failed", VOTE_COPY.captchaFailed);
    }
  }

  // Voter Code admission: enforced only when the authoritative snapshot
  // enables it. With Toggle off, a forged code value has no policy effect
  // and causes no lookup. The code is not part of the payload hash or
  // stored Vote row — it is an admission challenge like consumed Turnstile proof.
  let voterCodeRedemption: VoterCodeRedemptionContribution | null = null;
  if (poll.voterCodesEnabled) {
    const admissionOutcome = normalizeVoterCodeInput(input.voterCode);
    if (admissionOutcome.kind === "missing") {
      return failure("voter_code_missing", VOTER_CODE_ADMISSION_COPY.missing, {
        fieldErrors: { voterCode: VOTER_CODE_ADMISSION_COPY.missing },
        reasonCodes: { voterCode: "voter_code_missing" },
      });
    }
    if (admissionOutcome.kind === "invalid") {
      return failure("voter_code_invalid", VOTER_CODE_ADMISSION_COPY.invalid, {
        fieldErrors: { voterCode: VOTER_CODE_ADMISSION_COPY.invalid },
        reasonCodes: { voterCode: "voter_code_invalid" },
      });
    }
    if (!deps.lookupVoterCode) {
      return failure("vote_failed", VOTE_COPY.retry);
    }
    let lookupResult: { codeId: VoterCodeId; redeemed: boolean } | null;
    try {
      lookupResult = await deps.lookupVoterCode(poll.id, admissionOutcome.value);
    } catch {
      return failure("vote_failed", VOTE_COPY.retry);
    }
    const admission = resolveVoterCodeAdmission(
      admissionOutcome,
      lookupResult ? { found: true, codeId: lookupResult.codeId, redeemed: lookupResult.redeemed } : { found: false },
    );
    if ("code" in admission) {
      return failure(admission.code, admission.message, {
        fieldErrors: { voterCode: admission.message },
        reasonCodes: { voterCode: admission.code },
      });
    }
    // Build the redemption contribution now; it will be placed after
    // Poll-Type facts and before Session/IP claims in the batch so a
    // concurrent used-code collision has deterministic precedence.
    voterCodeRedemption = {
      kind: "voter_code_redemption",
      codeId: admission.codeId,
      voteId: "", // placeholder — filled after voteId generation
      redeemedAtMs: 0, // placeholder — filled after nowMs
    };
  }

  let voteId: string;
  try {
    voteId = deps.generateId();
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }
  let persistedFacts: PersistedVoteFacts;
  try {
    persistedFacts = strategy.persistFacts(validated.value);
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }
  const contributions: VotePersistenceContribution[] =
    persistedFacts.kind === "meeting"
      ? [
          { kind: "meeting_response", voteId, displayName: persistedFacts.displayName, revisionCapabilityDigest: input.pollType === "meeting" ? input.revisionCapabilityDigest : "" },
          ...persistedFacts.availability.map(({ meetingSlotId, state }) => ({ kind: "meeting_availability" as const, voteId, meetingSlotId, availability: state })),
        ]
    : persistedFacts.kind === "ranked_choice"
      ? persistedFacts.preferences.map(({ pollOptionId, rank }) => ({
          kind: "ranked_preference" as const,
          voteId,
          pollOptionId,
          rank,
        }))
      : persistedFacts.selections.map(({ pollOptionId }) => ({
          kind: "vote_selection" as const,
          voteId,
          pollOptionId,
        }));
  if (comment !== null) {
    let commentId: string;
    try {
      commentId = deps.generateId();
    } catch {
      return failure("vote_failed", VOTE_COPY.retry);
    }
    contributions.push(
      makeVoteCommentContribution(comment, {
        id: commentId,
        voteId,
        createdAtMs: nowMs,
      }),
    );
  }
  // Voter Code redemption: placed after Poll-Type/Comment facts and before
  // Session/IP claims so a concurrent used-code collision has deterministic
  // precedence inside the D1 batch.
  if (voterCodeRedemption !== null) {
    voterCodeRedemption.voteId = voteId;
    voterCodeRedemption.redeemedAtMs = nowMs;
    contributions.push(voterCodeRedemption as unknown as VotePersistenceContribution);
  }

  // Stable claim order: Session first, IP second (dual-collision precedence).
  if (sessionDigest !== null) {
    contributions.push({
      kind: "voter_claim",
      pollId: poll.id,
      checkKind: "session",
      digest: sessionDigest,
      voteId,
      createdAtMs: nowMs,
    });
  }
  if (ipDigest !== null) {
    contributions.push({
      kind: "voter_claim",
      pollId: poll.id,
      checkKind: "ip",
      digest: ipDigest,
      voteId,
      createdAtMs: nowMs,
    });
  }

  try {
    for (const contributor of deps.contributors ?? []) {
      contributions.push(
        ...(await contributor({
          poll,
          voteId,
          nowMs,
        })),
      );
    }
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }

  const batch: VotePersistenceBatch = {
    vote: {
      id: voteId,
      pollId: poll.id,
      submissionId: input.submissionId,
      payloadHash,
      createdAtMs: nowMs,
    },
    contributions,
    representationVersion: incrementRepresentationVersion(poll.id, nowMs),
  };

  try {
    await deps.persistVote(batch);
  } catch (cause) {
    if (cause instanceof SubmissionReplayError) {
      try {
        const concurrent = await deps.findVoteBySubmission(
          poll.id,
          input.submissionId,
        );
        return concurrent
          ? adjudicateReplay(poll.id, payloadHash, concurrent)
          : failure("vote_failed", VOTE_COPY.retry);
      } catch {
        return failure("vote_failed", VOTE_COPY.retry);
      }
    }
    if (cause instanceof AlreadyVotedError) {
      if (cause.checkKind === "ip") {
        return failure("already_voted_ip", VOTE_COPY.alreadyVotedIp);
      }
      return failure("already_voted", VOTE_COPY.alreadyVoted);
    }
    if (cause instanceof PollClosedError) {
      // The closed-poll trigger fires BEFORE the submission unique check, so
      // a replay arriving after close surfaces here. Re-read first: a voter
      // whose vote WAS recorded must get their stored outcome, never
      // "Your Vote wasn't recorded."
      try {
        const stored = await deps.findVoteBySubmission(
          poll.id,
          input.submissionId,
        );
        if (stored) {
          return adjudicateReplay(poll.id, payloadHash, stored);
        }
      } catch {
        return failure("vote_failed", VOTE_COPY.retry);
      }
      return failure("poll_closed", VOTE_COPY.pollClosed, {
        closedAtMs: poll.closedAtMs ?? poll.deadlineMs ?? nowMs,
      });
    }
    if (cause instanceof PollDefinitionChangedError) {
      return failure(
        "poll_definition_changed",
        VOTE_COPY.pollDefinitionChanged,
      );
    }
    if (cause instanceof CommentsDisabledError) {
      return failure("comments_disabled", COMMENT_COPY.disabled, {
        fieldErrors: { comment: COMMENT_COPY.disabled },
        reasonCodes: { comment: "comments_disabled" },
      });
    }
    if (cause instanceof PollGoneError) {
      // Option FK failures historically mapped to PollGone. Re-read the Poll
      // and selected option reachability so an edited-but-living Poll gets
      // poll_definition_changed instead of a false deleted 404 (Story 1.12).
      try {
        const stillThere = await deps.findPoll(poll.id);
        if (!stillThere) {
          return failure("poll_deleted", VOTE_COPY.pollDeleted);
        }
        if (deps.optionsStillReachable) {
          const reachable = await deps.optionsStillReachable(
            poll.id,
            validated.value.selectedOptionIds,
          );
          if (!reachable) {
            return failure(
              "poll_definition_changed",
              VOTE_COPY.pollDefinitionChanged,
            );
          }
        } else {
          // Without a reachability probe, prefer the changed-definition
          // outcome when the Poll still loads — never call a live Poll deleted.
          return failure(
            "poll_definition_changed",
            VOTE_COPY.pollDefinitionChanged,
          );
        }
      } catch {
        return failure("vote_failed", VOTE_COPY.retry);
      }
      return failure("vote_failed", VOTE_COPY.retry);
    }
    return failure("vote_failed", VOTE_COPY.retry);
  }

  return {
    ok: true,
    value: {
      acceptedAtMs: nowMs,
      existing: false,
      pollId: poll.id,
      voteId,
    },
  };
}

export {
  generateVoterCodes,
  generateCodesFromBytes,
  isValidBatchCount,
  VOTER_CODE_ALPHABET,
  VOTER_CODE_LENGTH,
  VOTER_CODE_BATCH_MIN,
  VOTER_CODE_BATCH_MAX,
  VOTER_CODE_BATCH_DEFAULT,
  VOTER_CODE_TOTAL_CAP,
  VOTER_CODE_COPY,
  type VoterCodeProjection,
  type VoterCodeInventory,
  type GenerateVoterCodesInput,
  type GenerateVoterCodesDeps,
  type StoredVoterCodeBatch,
} from "./voter-codes";
