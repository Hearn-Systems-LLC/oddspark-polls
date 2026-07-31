/** Module boundary placeholder — populated by later stories. */
// Voting application module (AD-19). CastVote is the sole coordinator for
// accepted vote facts. It is provider-free: adapters supply reads, hashing,
// digests, IDs, and the one constrained persistence batch.

import {
  incrementRepresentationVersion,
  type ApplicationError,
  type RepresentationVersionIncrement,
  type Result,
} from "../../shared/application/index";
import {
  effectivePollStatus,
  type PollId,
  type PollOptionId,
  type PollType,
} from "../../shared/domain/index";

export const VOTE_COPY = {
  counted: "Counted.",
  countedLive: "Results are live, updating as they arrive.",
  countedAfterClose:
    "Results open when the Poll closes — {deadline}. You'll find out when everyone else does.",
  countedCreatorOnly: "These results go to the Creator only.",
  alreadyVoted:
    "You've already voted here. Enthusiasm noted; the Tally is unchanged.",
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
  pollDeleted: "This Poll no longer exists.",
  idempotencyConflict:
    "Your earlier Vote stands — this change wasn't recorded.",
} as const;

export class AlreadyVotedError extends Error {
  constructor() {
    super("voter claim already exists");
    this.name = "AlreadyVotedError";
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

export type VotingPollSnapshot = {
  id: PollId;
  pollType: PollType;
  options: {
    id: PollOptionId;
    label: string;
    position: number;
  }[];
  sessionChecksEnabled: boolean;
  deadlineMs: number | null;
  closedAtMs: number | null;
};

export type VoteSubmission = {
  selectedOptionIds: readonly string[];
};

export type ValidatedVoteSubmission = {
  selectedOptionIds: readonly [PollOptionId];
};

export type VotingPollTypeStrategy = {
  validateSubmission: (
    submission: VoteSubmission,
    facts: Pick<VotingPollSnapshot, "options">,
  ) => Result<ValidatedVoteSubmission>;
  persistFacts: (validated: ValidatedVoteSubmission) => {
    selections: { pollOptionId: PollOptionId }[];
  };
};

export type VoteSelectionContribution = {
  kind: "vote_selection";
  voteId: string;
  pollOptionId: PollOptionId;
};

export type VoterClaimContribution = {
  kind: "voter_claim";
  pollId: PollId;
  checkKind: "session";
  digest: string;
  voteId: string;
  createdAtMs: number;
};

export type VoteExtensionContribution = {
  kind: `extension:${string}`;
  payload: Readonly<Record<string, unknown>>;
};

export type VotePersistenceContribution =
  | VoteSelectionContribution
  | VoterClaimContribution
  | VoteExtensionContribution;

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
  strategyFor: (pollType: PollType) => VotingPollTypeStrategy | null;
  createDigest: (input: {
    pollId: PollId;
    checkKind: "session";
    token: string;
  }) => Promise<string>;
  hashPayload: (payload: string) => Promise<string>;
  persistVote: (batch: VotePersistenceBatch) => Promise<void>;
  generateId: () => string;
  nowMs: () => number;
  contributors?: readonly VoteFactContributor[];
};

export type CastVoteInput = {
  pollId: PollId;
  submissionId: string;
  selectedOptionIds: readonly string[];
  browserToken: string | null;
};

export type CastVoteOutcome = {
  acceptedAtMs: number;
  existing: boolean;
  pollId: PollId;
  voteId: string;
};

export type VoteApplicationError = ApplicationError & {
  closedAtMs?: number;
};

export function normalizeVotePayload(
  pollId: PollId,
  selectedOptionIds: readonly string[],
): string {
  return JSON.stringify({
    pollId,
    selectedOptionIds: [...selectedOptionIds].sort(),
  });
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
  const normalizedPayload = normalizeVotePayload(
    input.pollId,
    input.selectedOptionIds,
  );

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
    validated = strategy.validateSubmission(
      { selectedOptionIds: input.selectedOptionIds },
      { options: poll.options },
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
    const message =
      strategyError.message.trim().length > 0
        ? strategyError.message
        : VOTE_COPY.retry;
    return failure("invalid_selection", message, detail);
  }

  let digest: string | null = null;
  if (poll.sessionChecksEnabled) {
    if (!input.browserToken) {
      return failure("session_token_missing", VOTE_COPY.retry);
    }
    try {
      digest = await deps.createDigest({
        pollId: poll.id,
        checkKind: "session",
        token: input.browserToken,
      });
    } catch {
      return failure("vote_failed", VOTE_COPY.retry);
    }
  }

  let voteId: string;
  try {
    voteId = deps.generateId();
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }
  let selections: { pollOptionId: PollOptionId }[];
  try {
    selections = strategy.persistFacts(validated.value).selections;
  } catch {
    return failure("vote_failed", VOTE_COPY.retry);
  }
  const contributions: VotePersistenceContribution[] = selections.map(
    ({ pollOptionId }) => ({
      kind: "vote_selection",
      voteId,
      pollOptionId,
    }),
  );
  if (digest !== null) {
    contributions.push({
      kind: "voter_claim",
      pollId: poll.id,
      checkKind: "session",
      digest,
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
    if (cause instanceof PollGoneError) {
      return failure("poll_deleted", VOTE_COPY.pollDeleted);
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
