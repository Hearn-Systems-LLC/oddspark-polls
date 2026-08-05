import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import {
  AlreadyVotedError,
  asVoterClaimDigest,
  CommentsDisabledError,
  PollClosedError,
  PollGoneError,
  SubmissionReplayError,
  VOTE_COPY,
  castVote,
  normalizeVotePayload,
  type CastVoteDeps,
  type VotePersistenceBatch,
  type VoteSubmission,
  type VoterClaimDigest,
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
const OPTION_C = "option-c" as PollOptionId;

/** Deterministic lowercase 64-hex claim digest for unit fixtures. */
function digestOf(seed: string): VoterClaimDigest {
  let out = "";
  for (let i = 0; i < 64; i += 1) {
    out += (seed.charCodeAt(i % seed.length) % 16).toString(16);
  }
  const branded = asVoterClaimDigest(out);
  if (branded === null) {
    throw new Error("fixture digest construction failed");
  }
  return branded;
}

const SESSION_DIGEST = digestOf("poll-1:session:browser-token");
const IP_DIGEST = digestOf("poll-1:ip:v4:203.0.113.8");

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
    ipChecksEnabled: false,
    captchaEnabled: false,
    commentsEnabled: false,
    multiSelectEnabled: false,
    minSelections: null,
    maxSelections: null,
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
      digestOf(`${pollId}:${checkKind}:${token}`),
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
  ipDigest: null as VoterClaimDigest | null,
  humanChallenge: "not_attempted" as const,
};

describe("normalizeVotePayload", () => {
  it("canonicalizes the Poll id and sorted selected option ids", () => {
    expect(normalizeVotePayload(POLL_ID, [OPTION_B, OPTION_A])).toBe(
      '{"pollId":"poll-1","selectedOptionIds":["option-a","option-b"]}',
    );
  });

  it("keeps the legacy no-Comment payload byte-for-byte and extends only Comment votes", () => {
    expect(normalizeVotePayload(POLL_ID, [OPTION_A])).toBe(
      '{"pollId":"poll-1","selectedOptionIds":["option-a"]}',
    );
    expect(
      normalizeVotePayload(POLL_ID, [OPTION_A], {
        body: "Context",
        displayName: "Jo",
      }),
    ).toBe(
      '{"pollId":"poll-1","selectedOptionIds":["option-a"],"comment":{"body":"Context","displayName":"Jo"}}',
    );
  });

  it("is invariant under every permutation of a ballot", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),
        fc
          .uniqueArray(fc.string({ minLength: 1 }), {
            minLength: 2,
            maxLength: 8,
          })
          .chain((ids) =>
            fc.tuple(
              fc.constant(ids),
              fc.shuffledSubarray(ids, {
                minLength: ids.length,
                maxLength: ids.length,
              }),
            ),
          ),
        (pollId, [ids, shuffled]) => {
          expect(normalizeVotePayload(pollId as PollId, ids)).toBe(
            normalizeVotePayload(pollId as PollId, shuffled),
          );
          // …but the Poll id stays load-bearing in the payload.
          expect(normalizeVotePayload(pollId as PollId, ids)).not.toBe(
            normalizeVotePayload(`${pollId}-other` as PollId, ids),
          );
        },
      ),
    );
  });
});

describe("castVote", () => {
  it("commits one typed Comment in the same Vote batch", async () => {
    const commandDeps = deps({
      findPoll: async () => poll({ commentsEnabled: true }),
    });
    const result = await castVote(commandDeps, {
      ...input,
      comment: { body: "  Context  ", displayName: "  Jo  " },
    });

    expect(result.ok).toBe(true);
    expect(commandDeps.persisted).toHaveLength(1);
    expect(commandDeps.persisted[0]?.contributions).toContainEqual({
      kind: "vote_comment",
      id: "vote-1",
      voteId: "vote-1",
      body: "Context",
      displayName: "Jo",
      createdAtMs: NOW,
    });
  });

  it("rejects forged Comment fields when the Poll has Comments disabled", async () => {
    const commandDeps = deps({ findPoll: async () => poll({ commentsEnabled: false }) });
    const result = await castVote(commandDeps, {
      ...input,
      comment: { body: "Forged", displayName: "Jo" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "comments_disabled",
        reasonCodes: { comment: "comments_disabled" },
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("prefers an authoritative disabled outcome over stale Comment validation", async () => {
    const commandDeps = deps({
      findPoll: async () => poll({ commentsEnabled: false }),
    });
    const result = await castVote(commandDeps, {
      ...input,
      comment: { body: "x".repeat(501), displayName: "Jo" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "comments_disabled",
        reasonCodes: { comment: "comments_disabled" },
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("maps an in-transaction Comment disable to the safe disabled outcome", async () => {
    const commandDeps = deps({
      findPoll: async () => poll({ commentsEnabled: true }),
      persistVote: async () => {
        throw new CommentsDisabledError();
      },
    });
    const result = await castVote(commandDeps, {
      ...input,
      comment: { body: "Late context", displayName: "Jo" },
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "comments_disabled",
        fieldErrors: { comment: "Comments aren't enabled for this Poll." },
        reasonCodes: { comment: "comments_disabled" },
      },
    });
  });

  it("uses canonical Comment content to adjudicate exact and divergent replays", async () => {
    const canonical = { body: "Context", displayName: "Jo" };
    const storedPayload = normalizeVotePayload(POLL_ID, [OPTION_A], canonical);
    const commandDeps = deps({
      findPoll: async () => {
        throw new Error("replay must not load Poll");
      },
      findVoteBySubmission: async () => ({
        voteId: "stored-vote",
        payloadHash: `hash:${storedPayload}`,
        createdAtMs: NOW - 1,
      }),
    });

    await expect(
      castVote(commandDeps, {
        ...input,
        comment: { body: " Context ", displayName: " Jo " },
      }),
    ).resolves.toMatchObject({ ok: true, value: { existing: true } });
    await expect(
      castVote(commandDeps, {
        ...input,
        comment: { body: "Changed", displayName: "Jo" },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "idempotency_conflict" },
    });
  });
  it("passes every required multi-select fact to strategy validation", async () => {
    const validateSubmission = vi.fn(() => ({
      ok: true as const,
      value: { selectedOptionIds: [OPTION_A, OPTION_B] },
    }));
    const commandDeps = deps({
      findPoll: async () =>
        poll({
          options: [
            { id: OPTION_A, label: "A", position: 0 },
            { id: OPTION_B, label: "B", position: 1 },
            { id: OPTION_C, label: "C", position: 2 },
          ],
          multiSelectEnabled: true,
          minSelections: 2,
          maxSelections: 2,
        }),
      strategyFor: () => ({
        validateSubmission,
        persistFacts: (validated) => ({
          selections: validated.selectedOptionIds.map((pollOptionId) => ({
            pollOptionId,
          })),
        }),
      }),
    });

    const result = await castVote(commandDeps, {
      ...input,
      selectedOptionIds: [OPTION_A, OPTION_B],
    });

    expect(result.ok).toBe(true);
    expect(validateSubmission).toHaveBeenCalledWith(
      { selectedOptionIds: [OPTION_A, OPTION_B] },
      {
        options: [
          { id: OPTION_A, label: "A", position: 0 },
          { id: OPTION_B, label: "B", position: 1 },
          { id: OPTION_C, label: "C", position: 2 },
        ],
        multiSelectEnabled: true,
        minSelections: 2,
        maxSelections: 2,
      },
    );
    expect(commandDeps.persisted[0]?.contributions).toEqual([
      {
        kind: "vote_selection",
        voteId: "vote-1",
        pollOptionId: OPTION_A,
      },
      {
        kind: "vote_selection",
        voteId: "vote-1",
        pollOptionId: OPTION_B,
      },
      {
        kind: "voter_claim",
        pollId: POLL_ID,
        checkKind: "session",
        digest: SESSION_DIGEST,
        voteId: "vote-1",
        createdAtMs: NOW,
      },
    ]);
  });

  it("passes contributor output through to the batch untouched (domain seam only — adapter rendering lands with Story 4.1)", async () => {
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
          digest: SESSION_DIGEST,
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
        message: VOTE_COPY.idempotencyConflict,
      },
    });
  });

  it("rejects a changed multi-select set replayed under the same submission id", async () => {
    const storedPayload = normalizeVotePayload(POLL_ID, [OPTION_A, OPTION_B]);
    const commandDeps = deps({
      findVoteBySubmission: async () => ({
        voteId: "stored-vote",
        payloadHash: `hash:${storedPayload}`,
        createdAtMs: NOW - 10,
      }),
    });

    await expect(
      castVote(commandDeps, {
        ...input,
        selectedOptionIds: [OPTION_A, OPTION_C],
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "idempotency_conflict",
        message: VOTE_COPY.idempotencyConflict,
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
    [
      new AlreadyVotedError("session"),
      "already_voted",
      VOTE_COPY.alreadyVoted,
    ],
    [
      new AlreadyVotedError("ip"),
      "already_voted_ip",
      VOTE_COPY.alreadyVotedIp,
    ],
    [new PollClosedError(), "poll_closed", VOTE_COPY.pollClosed],
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

  it("maps PollGone while the Poll still loads to poll_definition_changed", async () => {
    const commandDeps = deps({
      persistVote: async () => {
        throw new PollGoneError();
      },
    });
    const result = await castVote(commandDeps, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_definition_changed");
      expect(result.error.message).toBe(VOTE_COPY.pollDefinitionChanged);
    }
  });

  it("maps PollGone to poll_deleted when the Poll is gone on re-read", async () => {
    let findCalls = 0;
    const commandDeps = deps({
      findPoll: async () => {
        findCalls += 1;
        // First call for cast; second after PollGone.
        return findCalls === 1 ? poll() : null;
      },
      persistVote: async () => {
        throw new PollGoneError();
      },
    });
    const result = await castVote(commandDeps, input);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_deleted");
      expect(result.error.message).toBe(VOTE_COPY.pollDeleted);
    }
  });

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

  it("returns the stored outcome when a replay arrives after the Poll closed mid-flight", async () => {
    const normalized = normalizeVotePayload(POLL_ID, [OPTION_A]);
    let lookup = 0;
    const commandDeps = deps({
      findVoteBySubmission: async () => {
        lookup += 1;
        return lookup === 1
          ? null
          : {
              voteId: "stored-vote",
              payloadHash: `hash:${normalized}`,
              createdAtMs: NOW - 5,
            };
      },
      persistVote: async () => {
        throw new PollClosedError();
      },
    });

    await expect(castVote(commandDeps, input)).resolves.toEqual({
      ok: true,
      value: {
        acceptedAtMs: NOW - 5,
        existing: true,
        pollId: POLL_ID,
        voteId: "stored-vote",
      },
    });
  });

  it("conflicts when the post-close re-read finds a divergent payload hash", async () => {
    let lookup = 0;
    const commandDeps = deps({
      findVoteBySubmission: async () => {
        lookup += 1;
        return lookup === 1
          ? null
          : {
              voteId: "stored-vote",
              payloadHash: "different-hash",
              createdAtMs: NOW - 5,
            };
      },
      persistVote: async () => {
        throw new PollClosedError();
      },
    });

    await expect(castVote(commandDeps, input)).resolves.toEqual({
      ok: false,
      error: {
        code: "idempotency_conflict",
        message: VOTE_COPY.idempotencyConflict,
      },
    });
  });

  it("fails honestly when the post-close re-read cannot confirm a stored vote", async () => {
    let lookup = 0;
    const commandDeps = deps({
      findVoteBySubmission: async () => {
        lookup += 1;
        if (lookup === 1) {
          return null;
        }
        throw new Error("D1 read failed");
      },
      persistVote: async () => {
        throw new PollClosedError();
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

  it("conflicts when the race re-read finds a divergent payload hash", async () => {
    let lookup = 0;
    const commandDeps = deps({
      findVoteBySubmission: async () => {
        lookup += 1;
        return lookup === 1
          ? null
          : {
              voteId: "concurrent-vote",
              payloadHash: "different-hash",
              createdAtMs: NOW - 1,
            };
      },
      persistVote: async () => {
        throw new SubmissionReplayError();
      },
    });

    await expect(castVote(commandDeps, input)).resolves.toEqual({
      ok: false,
      error: {
        code: "idempotency_conflict",
        message: VOTE_COPY.idempotencyConflict,
      },
    });
  });

  it("preserves the strategy's message and field errors on an invalid selection", async () => {
    const message = "That ballot does not match this Poll.";
    const commandDeps = deps({
      strategyFor: () => ({
        validateSubmission: () => ({
          ok: false,
          error: {
            code: "invalid_selection",
            message,
            fieldErrors: { selectedOptionIds: message },
            reasonCodes: { selectedOptionIds: "invalid_selection" },
          },
        }),
        persistFacts: () => ({ selections: [] }),
      }),
    });

    const result = await castVote(commandDeps, input);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_selection",
        message,
        fieldErrors: { selectedOptionIds: message },
        reasonCodes: { selectedOptionIds: "invalid_selection" },
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("falls back to the retry idiom when a strategy error message is blank", async () => {
    const commandDeps = deps({
      strategyFor: () => ({
        validateSubmission: () => ({
          ok: false,
          error: {
            code: "invalid_selection",
            message: "   ",
          },
        }),
        persistFacts: () => ({ selections: [] }),
      }),
    });

    const result = await castVote(commandDeps, input);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_selection",
        message: VOTE_COPY.retry,
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("keeps the zero-selection copy while preserving the strategy's field errors", async () => {
    const message = "Nothing's selected. Pick an option, then vote.";
    const commandDeps = deps({
      strategyFor: () => ({
        validateSubmission: () => ({
          ok: false,
          error: {
            code: "selection_required",
            message,
            fieldErrors: { selectedOptionIds: message },
            reasonCodes: { selectedOptionIds: "selection_required" },
          },
        }),
        persistFacts: () => ({ selections: [] }),
      }),
    });

    const result = await castVote(commandDeps, input);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "selection_required",
        message: VOTE_COPY.selectionRequired,
        fieldErrors: { selectedOptionIds: message },
        reasonCodes: { selectedOptionIds: "selection_required" },
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it.each([
    [
      "too_few_selections",
      "Not enough selections. This Poll asks for at least 2, and your ballot is still here.",
    ],
    [
      "too_many_selections",
      "Too many selections. This Poll takes up to 3, and your ballot is still here.",
    ],
  ] as const)("passes through %s strategy copy unmodified", async (code, message) => {
    const commandDeps = deps({
      strategyFor: () => ({
        validateSubmission: () => ({
          ok: false,
          error: {
            code,
            message,
            fieldErrors: { selectedOptionIds: message },
            reasonCodes: { selectedOptionIds: code },
          },
        }),
        persistFacts: () => ({ selections: [] }),
      }),
    });

    await expect(castVote(commandDeps, input)).resolves.toEqual({
      ok: false,
      error: {
        code,
        message,
        fieldErrors: { selectedOptionIds: message },
        reasonCodes: { selectedOptionIds: code },
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it.each<[string, Partial<CastVoteDeps>]>([
    [
      "the payload hash read",
      {
        hashPayload: async () => {
          throw new Error("crypto unavailable");
        },
      },
    ],
    [
      "the stored-vote lookup",
      {
        findVoteBySubmission: async () => {
          throw new Error("read failed");
        },
      },
    ],
    [
      "the Poll lookup",
      {
        findPoll: async () => {
          throw new Error("read failed");
        },
      },
    ],
    [
      "the digest read",
      {
        createDigest: async () => {
          throw new Error("hmac failed");
        },
      },
    ],
    [
      "the clock",
      {
        nowMs: () => {
          throw new Error("clock broke");
        },
      },
    ],
    [
      "the id generator",
      {
        generateId: () => {
          throw new Error("ids exhausted");
        },
      },
    ],
    [
      "a fact contributor",
      {
        contributors: [
          async () => {
            throw new Error("contributor broke");
          },
        ],
      },
    ],
    [
      "the strategy resolver",
      {
        strategyFor: () => {
          throw new Error("registry broke");
        },
      },
    ],
    [
      "strategy validation",
      {
        strategyFor: () => ({
          validateSubmission: () => {
            throw new Error("validator broke");
          },
          persistFacts: () => ({ selections: [] }),
        }),
      },
    ],
    [
      "strategy fact persistence",
      {
        strategyFor: () => ({
          validateSubmission: (submission: VoteSubmission) => ({
            ok: true as const,
            value: {
              selectedOptionIds: [
                submission.selectedOptionIds[0] as PollOptionId,
              ] as readonly PollOptionId[],
            },
          }),
          persistFacts: () => {
            throw new Error("facts broke");
          },
        }),
      },
    ],
  ])("fails safely when %s throws", async (_dependency, override) => {
    const commandDeps = deps(override);

    await expect(castVote(commandDeps, input)).resolves.toEqual({
      ok: false,
      error: {
        code: "vote_failed",
        message: VOTE_COPY.retry,
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("fails safely when no strategy exists for the Poll type", async () => {
    const commandDeps = deps({ strategyFor: () => null });

    await expect(castVote(commandDeps, input)).resolves.toEqual({
      ok: false,
      error: {
        code: "vote_failed",
        message: VOTE_COPY.retry,
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("creates no claims when both Session and IP checks are off", async () => {
    const commandDeps = deps({
      findPoll: async () =>
        poll({ sessionChecksEnabled: false, ipChecksEnabled: false }),
    });
    const result = await castVote(commandDeps, {
      ...input,
      browserToken: null,
      ipDigest: IP_DIGEST,
    });
    expect(result.ok).toBe(true);
    expect(
      commandDeps.persisted[0]?.contributions.filter(
        (c) => c.kind === "voter_claim",
      ),
    ).toEqual([]);
  });

  it("creates only a Session claim when Session is on and IP is off", async () => {
    const commandDeps = deps({
      findPoll: async () =>
        poll({ sessionChecksEnabled: true, ipChecksEnabled: false }),
    });
    await castVote(commandDeps, { ...input, ipDigest: IP_DIGEST });
    const claims = commandDeps.persisted[0]?.contributions.filter(
      (c) => c.kind === "voter_claim",
    );
    expect(claims).toEqual([
      {
        kind: "voter_claim",
        pollId: POLL_ID,
        checkKind: "session",
        digest: SESSION_DIGEST,
        voteId: "vote-1",
        createdAtMs: NOW,
      },
    ]);
  });

  it("creates only an IP claim when IP is on and Session is off", async () => {
    const commandDeps = deps({
      findPoll: async () =>
        poll({ sessionChecksEnabled: false, ipChecksEnabled: true }),
    });
    await castVote(commandDeps, {
      ...input,
      browserToken: null,
      ipDigest: IP_DIGEST,
    });
    const claims = commandDeps.persisted[0]?.contributions.filter(
      (c) => c.kind === "voter_claim",
    );
    expect(claims).toEqual([
      {
        kind: "voter_claim",
        pollId: POLL_ID,
        checkKind: "ip",
        digest: IP_DIGEST,
        voteId: "vote-1",
        createdAtMs: NOW,
      },
    ]);
  });

  it("creates Session then IP claims in stable order when both are on", async () => {
    const commandDeps = deps({
      findPoll: async () =>
        poll({ sessionChecksEnabled: true, ipChecksEnabled: true }),
    });
    await castVote(commandDeps, { ...input, ipDigest: IP_DIGEST });
    const claims = commandDeps.persisted[0]?.contributions.filter(
      (c) => c.kind === "voter_claim",
    );
    expect(claims).toEqual([
      {
        kind: "voter_claim",
        pollId: POLL_ID,
        checkKind: "session",
        digest: SESSION_DIGEST,
        voteId: "vote-1",
        createdAtMs: NOW,
      },
      {
        kind: "voter_claim",
        pollId: POLL_ID,
        checkKind: "ip",
        digest: IP_DIGEST,
        voteId: "vote-1",
        createdAtMs: NOW,
      },
    ]);
  });

  it("returns ip_check_unavailable when IP is on and the digest is missing", async () => {
    const commandDeps = deps({
      findPoll: async () =>
        poll({ sessionChecksEnabled: false, ipChecksEnabled: true }),
    });
    const result = await castVote(commandDeps, {
      ...input,
      browserToken: null,
      ipDigest: null,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "ip_check_unavailable",
        message: VOTE_COPY.retry,
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("returns ip_check_unavailable when IP is on and the digest is malformed", async () => {
    const commandDeps = deps({
      findPoll: async () =>
        poll({ sessionChecksEnabled: false, ipChecksEnabled: true }),
    });
    const result = await castVote(commandDeps, {
      ...input,
      browserToken: null,
      // Deliberately forged non-hex value — cast is the hostile call site.
      ipDigest: "not-a-digest" as unknown as VoterClaimDigest,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "ip_check_unavailable",
        message: VOTE_COPY.retry,
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("ignores a prepared IP digest when the authoritative snapshot has IP off", async () => {
    const commandDeps = deps({
      findPoll: async () =>
        poll({ sessionChecksEnabled: false, ipChecksEnabled: false }),
    });
    await castVote(commandDeps, {
      ...input,
      browserToken: null,
      ipDigest: IP_DIGEST,
    });
    expect(
      commandDeps.persisted[0]?.contributions.some(
        (c) => c.kind === "voter_claim" && c.checkKind === "ip",
      ),
    ).toBe(false);
  });

  it("does not prepare claims when an exact replay is adjudicated first", async () => {
    const createDigest = vi.fn(async () => SESSION_DIGEST);
    const persistVote = vi.fn();
    const normalized = normalizeVotePayload(POLL_ID, [OPTION_A]);
    const commandDeps = deps({
      createDigest,
      persistVote,
      findVoteBySubmission: async () => ({
        voteId: "stored-vote",
        payloadHash: `hash:${normalized}`,
        createdAtMs: NOW - 10,
      }),
    });
    const result = await castVote(commandDeps, {
      ...input,
      ipDigest: IP_DIGEST,
    });
    expect(result.ok).toBe(true);
    expect(createDigest).not.toHaveBeenCalled();
    expect(persistVote).not.toHaveBeenCalled();
  });

  it("rejects a Session digest that fails runtime validation", async () => {
    const commandDeps = deps({
      // Deliberately hostile adapter result despite the branded port.
      createDigest: async () => "short" as unknown as VoterClaimDigest,
    });
    const result = await castVote(commandDeps, input);
    expect(result).toEqual({
      ok: false,
      error: {
        code: "vote_failed",
        message: VOTE_COPY.retry,
      },
    });
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("requires passed proof when authoritative CAPTCHA is on", async () => {
    const commandDeps = deps({
      findPoll: async () => poll({ captchaEnabled: true }),
    });
    for (const humanChallenge of ["failed", "not_attempted"] as const) {
      const result = await castVote(commandDeps, {
        ...input,
        humanChallenge,
      });
      expect(result).toEqual({
        ok: false,
        error: {
          code: "captcha_failed",
          message: VOTE_COPY.captchaFailed,
        },
      });
    }
    expect(commandDeps.persisted).toHaveLength(0);
  });

  it("accepts a new CAPTCHA-on ballot only with passed proof", async () => {
    const commandDeps = deps({
      findPoll: async () => poll({ captchaEnabled: true }),
    });
    const result = await castVote(commandDeps, {
      ...input,
      humanChallenge: "passed",
    });
    expect(result.ok).toBe(true);
    expect(commandDeps.persisted).toHaveLength(1);
  });

  it("ignores stale challenge failure when authoritative CAPTCHA is off", async () => {
    const commandDeps = deps({
      findPoll: async () => poll({ captchaEnabled: false }),
    });
    const result = await castVote(commandDeps, {
      ...input,
      humanChallenge: "failed",
    });
    expect(result.ok).toBe(true);
    expect(commandDeps.persisted).toHaveLength(1);
  });

  it("adjudicates exact replay before CAPTCHA proof when CAPTCHA is on", async () => {
    const normalized = normalizeVotePayload(POLL_ID, [OPTION_A]);
    const persistVote = vi.fn(async () => {
      throw new Error("must not persist on replay");
    });
    const commandDeps = deps({
      findPoll: async () => poll({ captchaEnabled: true }),
      findVoteBySubmission: async () => ({
        voteId: "stored-vote",
        payloadHash: `hash:${normalized}`,
        createdAtMs: NOW - 10,
      }),
      persistVote,
    });
    const result = await castVote(commandDeps, {
      ...input,
      humanChallenge: "not_attempted",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.existing).toBe(true);
    }
    expect(persistVote).not.toHaveBeenCalled();
  });

  it("never includes challenge state in the normalized payload hash", async () => {
    expect(normalizeVotePayload(POLL_ID, [OPTION_A])).toBe(
      '{"pollId":"poll-1","selectedOptionIds":["option-a"]}',
    );
    expect(normalizeVotePayload(POLL_ID, [OPTION_A])).not.toContain("captcha");
    expect(normalizeVotePayload(POLL_ID, [OPTION_A])).not.toContain(
      "humanChallenge",
    );
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
      tooFewSelections:
        "Not enough selections. This Poll asks for at least {min}, and your ballot is still here.",
      tooManySelections:
        "Too many selections. This Poll takes up to {max}, and your ballot is still here.",
      pollDeleted: "This Poll no longer exists.",
      pollDefinitionChanged:
        "This Poll changed while you were deciding. Your Vote wasn't recorded — review the options and try again.",
      idempotencyConflict:
        "Your earlier Vote stands — this change wasn't recorded.",
      captchaFailed:
        "The human check didn't pass. Try it again — it's usually just a fluke.",
    });
  });
});
