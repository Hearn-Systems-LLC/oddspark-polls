import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  AlreadyVotedError,
  PollClosedError,
  PollGoneError,
  SubmissionReplayError,
  VOTE_COPY,
  castVote,
  normalizeVotePayload,
  type CastVoteDeps,
  type VotePersistenceBatch,
  type VotingPollSnapshot,
} from "../../src/modules/voting/index";
import type {
  PollId,
  PollOptionId,
} from "../../src/shared/domain/index";

const NOW = 1_800_000_000_000;
const POLL_ID = "poll-1" as PollId;
const OPTION_A = "option-a" as PollOptionId;
const OPTION_B = "option-b" as PollOptionId;

function poll(
  overrides: Partial<VotingPollSnapshot> = {},
): VotingPollSnapshot {
  return {
    id: POLL_ID,
    pollType: "multiple_choice",
    options: [
      { id: OPTION_A, label: "A", position: 0 },
      { id: OPTION_B, label: "B", position: 1 },
    ],
    sessionChecksEnabled: true,
    deadlineMs: null,
    closedAtMs: null,
    ...overrides,
  };
}

function deps(
  overrides: Partial<CastVoteDeps> = {},
): CastVoteDeps & { persisted: VotePersistenceBatch[] } {
  const persisted: VotePersistenceBatch[] = [];
  return {
    persisted,
    findPoll: async () => poll(),
    findVoteBySubmission: async () => null,
    strategyFor: () => ({
      validateSubmission: (submission, facts) => {
        const selectedOptionId = submission.selectedOptionIds[0];
        if (
          submission.selectedOptionIds.length !== 1 ||
          !facts.options.some(({ id }) => id === selectedOptionId)
        ) {
          return {
            ok: false,
            error: {
              code: "invalid_selection",
              message: "Invalid selection.",
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
    }),
    createDigest: async ({ pollId, checkKind, token }) =>
      `digest:${pollId}:${checkKind}:${token}`,
    hashPayload: async (payload) => `hash:${payload}`,
    persistVote: async (batch) => {
      persisted.push(batch);
    },
    generateId: () => "vote-1",
    nowMs: () => NOW,
    ...overrides,
  };
}

const input = {
  pollId: POLL_ID,
  submissionId: "submission-1",
  selectedOptionIds: [OPTION_A],
  browserToken: "browser-token",
};

describe("normalizeVotePayload", () => {
  it("canonicalizes the Poll id and sorted selected option ids", () => {
    expect(normalizeVotePayload(POLL_ID, [OPTION_B, OPTION_A])).toBe(
      '{"pollId":"poll-1","selectedOptionIds":["option-a","option-b"]}',
    );
  });

  it("is invariant under every permutation of a ballot", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (ids) => {
          const reversed = [...ids].reverse();
          expect(
            normalizeVotePayload(POLL_ID, ids),
          ).toBe(normalizeVotePayload(POLL_ID, reversed));
        },
      ),
    );
  });
});

describe("castVote", () => {
  it("builds one ordered batch with type facts, claim, extensions, and version increment", async () => {
    const commandDeps = deps({
      contributors: [
        async ({ voteId }) => [
          {
            kind: "extension:test",
            payload: { voteId, proof: "contributed" },
          },
        ],
      ],
    });

    const result = await castVote(commandDeps, input);

    expect(result).toEqual({
      ok: true,
      value: {
        acceptedAtMs: NOW,
        existing: false,
        pollId: POLL_ID,
        voteId: "vote-1",
      },
    });
    expect(commandDeps.persisted).toHaveLength(1);
    expect(commandDeps.persisted[0]).toMatchObject({
      vote: {
        id: "vote-1",
        pollId: POLL_ID,
        submissionId: "submission-1",
        createdAtMs: NOW,
      },
      contributions: [
        {
          kind: "vote_selection",
          voteId: "vote-1",
          pollOptionId: OPTION_A,
        },
        {
          kind: "voter_claim",
          pollId: POLL_ID,
          checkKind: "session",
          digest: `digest:${POLL_ID}:session:browser-token`,
          voteId: "vote-1",
          createdAtMs: NOW,
        },
        {
          kind: "extension:test",
          payload: { voteId: "vote-1", proof: "contributed" },
        },
      ],
      representationVersion: {
        kind: "increment_representation_version",
        pollId: POLL_ID,
        updatedAtMs: NOW,
      },
    });
  });

  it("returns an identical committed replay before Poll lookup or re-validation", async () => {
    const findPoll = vi.fn(async () => poll());
    const strategyFor = vi.fn(() => null);
    const normalized = normalizeVotePayload(POLL_ID, [OPTION_A]);
    const commandDeps = deps({
      findPoll,
      strategyFor,
      findVoteBySubmission: async () => ({
        voteId: "stored-vote",
        payloadHash: `hash:${normalized}`,
        createdAtMs: NOW - 10,
      }),
    });

    await expect(castVote(commandDeps, input)).resolves.toEqual({
      ok: true,
      value: {
        acceptedAtMs: NOW - 10,
        existing: true,
        pollId: POLL_ID,
        voteId: "stored-vote",
      },
    });
    expect(findPoll).not.toHaveBeenCalled();
    expect(strategyFor).not.toHaveBeenCalled();
  });

  it("rejects a divergent committed replay with the stable conflict code", async () => {
    const commandDeps = deps({
      findVoteBySubmission: async () => ({
        voteId: "stored-vote",
        payloadHash: "different-hash",
        createdAtMs: NOW - 10,
      }),
    });

    const result = await castVote(commandDeps, input);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "idempotency_conflict",
        message: VOTE_COPY.retry,
      },
    });
  });

  it("uses effective Poll state as the friendly closed pre-check", async () => {
    const persistVote = vi.fn();
    const commandDeps = deps({
      findPoll: async () => poll({ deadlineMs: NOW }),
      persistVote,
    });

    const result = await castVote(commandDeps, input);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "poll_closed",
        message: VOTE_COPY.pollClosed,
        closedAtMs: NOW,
      },
    });
    expect(persistVote).not.toHaveBeenCalled();
  });

  it("rejects a missing browser token when Session Checks are enabled", async () => {
    const commandDeps = deps();
    const result = await castVote(commandDeps, {
      ...input,
      browserToken: null,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "session_token_missing",
        message: VOTE_COPY.retry,
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("omits the claim when Session Checks are disabled", async () => {
    const commandDeps = deps({
      findPoll: async () => poll({ sessionChecksEnabled: false }),
    });
    const result = await castVote(commandDeps, {
      ...input,
      browserToken: null,
    });

    expect(result.ok).toBe(true);
    expect(commandDeps.persisted[0]?.contributions).toEqual([
      {
        kind: "vote_selection",
        voteId: "vote-1",
        pollOptionId: OPTION_A,
      },
    ]);
  });

  it.each([
    [new AlreadyVotedError(), "already_voted", VOTE_COPY.alreadyVoted],
    [new PollClosedError(), "poll_closed", VOTE_COPY.pollClosed],
    [new PollGoneError(), "poll_deleted", VOTE_COPY.pollDeleted],
    [new Error("driver detail"), "vote_failed", VOTE_COPY.retry],
  ])(
    "maps persistence failures to safe stable outcomes",
    async (cause, code, message) => {
      const commandDeps = deps({
        persistVote: async () => {
          throw cause;
        },
      });
      const result = await castVote(commandDeps, input);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
        expect(result.error.message).toBe(message);
        expect(result.error.message).not.toContain("driver detail");
      }
    },
  );

  it("adjudicates a concurrent submission collision by re-reading the stored hash", async () => {
    let lookup = 0;
    const normalized = normalizeVotePayload(POLL_ID, [OPTION_A]);
    const commandDeps = deps({
      findVoteBySubmission: async () => {
        lookup += 1;
        return lookup === 1
          ? null
          : {
              voteId: "concurrent-vote",
              payloadHash: `hash:${normalized}`,
              createdAtMs: NOW - 1,
            };
      },
      persistVote: async () => {
        throw new SubmissionReplayError();
      },
    });

    await expect(castVote(commandDeps, input)).resolves.toEqual({
      ok: true,
      value: {
        acceptedAtMs: NOW - 1,
        existing: true,
        pollId: POLL_ID,
        voteId: "concurrent-vote",
      },
    });
  });

  it("returns an honest generic failure when a submission collision cannot be confirmed", async () => {
    const commandDeps = deps({
      persistVote: async () => {
        throw new SubmissionReplayError();
      },
    });

    await expect(castVote(commandDeps, input)).resolves.toEqual({
      ok: false,
      error: {
        code: "vote_failed",
        message: VOTE_COPY.retry,
      },
    });
  });

  it("returns Poll deletion when the Poll read no longer exists", async () => {
    const commandDeps = deps({
      findPoll: async () => null,
    });

    await expect(castVote(commandDeps, input)).resolves.toEqual({
      ok: false,
      error: {
        code: "poll_deleted",
        message: VOTE_COPY.pollDeleted,
      },
    });
  });
});

describe("VOTE_COPY", () => {
  it("pins the voter-facing catalog exactly", () => {
    expect(VOTE_COPY).toEqual({
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
      selectionRequired: "Nothing's selected. Pick an option, then vote.",
      pollDeleted: "This Poll no longer exists.",
    });
  });
});
