import { describe, expect, it } from "vitest";
import {
  createPoll,
  validateCreatePoll,
  type CreatePollDraft,
  type PollPersistenceRows,
} from "../../src/modules/polls/index";
import { rankedChoiceStrategy } from "../../src/modules/polls/types/ranked-choice";
import { votingStrategyFor } from "../../src/modules/polls/types/registry";
import {
  castVote,
  normalizeRankedVotePayload,
  type CastVoteDeps,
  type StoredVoteOutcome,
  type VotePersistenceBatch,
  type VoterClaimDigest,
  type VotingPollSnapshot,
} from "../../src/modules/voting/index";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";

const NOW = 1_800_000_000_000;
const POLL_ID = "ranked-poll" as PollId;
const OPTION_A = "ranked-option-a" as PollOptionId;
const OPTION_B = "ranked-option-b" as PollOptionId;
const OPTION_C = "ranked-option-c" as PollOptionId;

function createDraft(
  overrides: Partial<CreatePollDraft> = {},
): CreatePollDraft {
  return {
    pollType: "ranked_choice",
    question: "Put these in order",
    description: "",
    options: ["A", "B", "C"],
    resultVisibility: "live",
    discoveryState: "unlisted",
    deadlineLocal: "",
    timeZone: "",
    customLink: "",
    multiSelect: "false",
    minSelections: "",
    maxSelections: "",
    sessionChecks: "false",
    ipChecks: "false",
    voterCodes: "false",
    captcha: "false",
    vpnBlocking: "false",
    ...overrides,
  };
}

function rankedPoll(): VotingPollSnapshot {
  return {
    id: POLL_ID,
    pollType: "ranked_choice",
    options: [
      { id: OPTION_A, label: "A", position: 0 },
      { id: OPTION_B, label: "B", position: 1 },
      { id: OPTION_C, label: "C", position: 2 },
    ],
    sessionChecksEnabled: false,
    ipChecksEnabled: false,
    captchaEnabled: false,
    commentsEnabled: false,
    multiSelectEnabled: false,
    minSelections: null,
    maxSelections: null,
    deadlineMs: null,
    closedAtMs: null,
  };
}

function rankedInput(preferences: { optionId: string; rank: number }[]) {
  return {
    pollId: POLL_ID,
    submissionId: "ranked-submission",
    pollType: "ranked_choice" as const,
    selectedOptionIds: [] as string[],
    rankedPreferences: preferences,
    browserToken: null,
    ipDigest: null as VoterClaimDigest | null,
    humanChallenge: "not_attempted" as const,
  };
}

describe("Ranked Choice creation", () => {
  it("normalizes explicit Ranked Choice with no Multiple-Choice bounds", () => {
    const result = validateCreatePoll(createDraft(), NOW);
    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        pollType: "ranked_choice",
        multiSelect: false,
        minSelections: null,
        maxSelections: null,
        options: [
          { label: "A", position: 0 },
          { label: "B", position: 1 },
          { label: "C", position: 2 },
        ],
      }),
    });
  });

  it("rejects unsupported types and Ranked Choice multi-select bounds", () => {
    expect(validateCreatePoll(createDraft({ pollType: "unsupported" }), NOW)).toEqual({
      ok: false,
      error: expect.objectContaining({
        fieldErrors: expect.objectContaining({
          pollType: "Pick a supported Poll Type.",
        }),
      }),
    });
    expect(
      validateCreatePoll(
        createDraft({ multiSelect: "true", minSelections: "1" }),
        NOW,
      ),
    ).toEqual({
      ok: false,
      error: expect.objectContaining({
        reasonCodes: expect.objectContaining({
          multiSelect: "ranked_bounds_invalid",
        }),
      }),
    });
  });

  it("contributes the explicit type and disabled bounds to one creation batch", async () => {
    const persisted: PollPersistenceRows[] = [];
    let generated = 0;
    const result = await createPoll(
      {
        persist: async (input) => {
          persisted.push(input);
        },
        generateId: () => `generated-${(generated += 1)}`,
        generateReference: () => "ranked-reference",
        nowMs: () => NOW,
      },
      "owner" as UserId,
      createDraft(),
    );

    expect(result.ok).toBe(true);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.poll).toMatchObject({
      pollType: "ranked_choice",
      multiSelectEnabled: false,
      minSelections: null,
      maxSelections: null,
    });
  });
});

describe("rankedChoiceStrategy", () => {
  const facts = { options: rankedPoll().options };

  it("accepts any non-empty ordered subset and canonicalizes it by rank", () => {
    expect(
      rankedChoiceStrategy.validateSubmission(
        {
          kind: "ranked_choice",
          selectedOptionIds: [],
          rankedPreferences: [
            { optionId: OPTION_C, rank: 2 },
            { optionId: OPTION_A, rank: 1 },
          ],
        },
        facts,
      ),
    ).toEqual({
      ok: true,
      value: {
        kind: "ranked_choice",
        selectedOptionIds: [OPTION_A, OPTION_C],
        rankedPreferences: [
          { pollOptionId: OPTION_A, rank: 1 },
          { pollOptionId: OPTION_C, rank: 2 },
        ],
      },
    });
  });

  it.each([
    ["empty", []],
    [
      "duplicate option",
      [
        { optionId: OPTION_A, rank: 1 },
        { optionId: OPTION_A, rank: 2 },
      ],
    ],
    [
      "duplicate rank",
      [
        { optionId: OPTION_A, rank: 1 },
        { optionId: OPTION_B, rank: 1 },
      ],
    ],
    ["skipped rank", [{ optionId: OPTION_A, rank: 2 }]],
    ["unknown option", [{ optionId: "unknown", rank: 1 }]],
    ["non-integer rank", [{ optionId: OPTION_A, rank: 1.5 }]],
  ])("rejects a %s Ballot", (_case, rankedPreferences) => {
    const result = rankedChoiceStrategy.validateSubmission(
      {
        kind: "ranked_choice",
        selectedOptionIds: [],
        rankedPreferences,
      },
      facts,
    );
    expect(result.ok).toBe(false);
  });
});

describe("Ranked Choice CastVote", () => {
  it("keeps transport row order canonical but preference order significant", () => {
    const first = normalizeRankedVotePayload(POLL_ID, [
      { optionId: OPTION_B, rank: 2 },
      { optionId: OPTION_A, rank: 1 },
    ]);
    const same = normalizeRankedVotePayload(POLL_ID, [
      { optionId: OPTION_A, rank: 1 },
      { optionId: OPTION_B, rank: 2 },
    ]);
    const reordered = normalizeRankedVotePayload(POLL_ID, [
      { optionId: OPTION_A, rank: 2 },
      { optionId: OPTION_B, rank: 1 },
    ]);
    expect(first).toBe(same);
    expect(reordered).not.toBe(first);
  });

  it("commits exact ordered preferences and adjudicates reordered replay as conflict", async () => {
    let stored: StoredVoteOutcome | null = null;
    const persisted: VotePersistenceBatch[] = [];
    const deps: CastVoteDeps = {
      findPoll: async () => rankedPoll(),
      findVoteBySubmission: async () => stored,
      strategyFor: votingStrategyFor,
      createDigest: async () => {
        throw new Error("not used");
      },
      hashPayload: async (payload) => payload,
      persistVote: async (batch) => {
        persisted.push(batch);
        stored = {
          voteId: batch.vote.id,
          payloadHash: batch.vote.payloadHash,
          createdAtMs: batch.vote.createdAtMs,
        };
      },
      generateId: () => "ranked-vote",
      nowMs: () => NOW,
    };
    const accepted = await castVote(
      deps,
      rankedInput([
        { optionId: OPTION_B, rank: 1 },
        { optionId: OPTION_A, rank: 2 },
      ]),
    );
    expect(accepted).toEqual({
      ok: true,
      value: {
        acceptedAtMs: NOW,
        existing: false,
        pollId: POLL_ID,
        voteId: "ranked-vote",
      },
    });
    expect(persisted[0]?.contributions).toEqual([
      {
        kind: "ranked_preference",
        voteId: "ranked-vote",
        pollOptionId: OPTION_B,
        rank: 1,
      },
      {
        kind: "ranked_preference",
        voteId: "ranked-vote",
        pollOptionId: OPTION_A,
        rank: 2,
      },
    ]);

    await expect(
      castVote(
        deps,
        rankedInput([
          { optionId: OPTION_A, rank: 1 },
          { optionId: OPTION_B, rank: 2 },
        ]),
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "idempotency_conflict",
        message: "Your earlier Vote stands — this change wasn't recorded.",
      },
    });
    expect(persisted).toHaveLength(1);
  });

  it("projectResults delegates to the shared pure IRV tabulator", () => {
    const ranked = rankedChoiceStrategy.projectResults({
      options: [
        { id: OPTION_A, label: "A", position: 0 },
        { id: OPTION_B, label: "B", position: 1 },
        { id: OPTION_C, label: "C", position: 2 },
      ],
      ballots: [
        { preferences: [OPTION_A, OPTION_B, OPTION_C] },
        { preferences: [OPTION_A, OPTION_C, OPTION_B] },
        { preferences: [OPTION_B, OPTION_A, OPTION_C] },
      ],
    });
    expect(ranked.resolved).toBe(true);
    expect(ranked.winnerId).toBe(OPTION_A);
    expect(ranked.voterCount).toBe(3);
    expect(ranked).not.toHaveProperty("representationVersion");
  });

  it("projectExport produces a valid projection for ranked Choice", () => {
    const result = rankedChoiceStrategy.projectExport({
      options: [
        { label: "Alpha", position: 0, count: 2 },
        { label: "Beta", position: 1, count: 1 },
      ],
      votes: [
        { alignmentKey: 0, createdAtMs: 1000, rankedOptionPositions: [0, 1] },
        { alignmentKey: 1, createdAtMs: 2000, rankedOptionPositions: [1, 0] },
        { alignmentKey: 2, createdAtMs: 3000, rankedOptionPositions: [0] },
      ],
      voterCount: 3,
      selectionCount: 5,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.voterCount).toBe(3);
      expect(result.value.selectionCount).toBe(5);
      expect(result.value.votes.columns).toEqual(["RANK 1", "RANK 2"]);
      expect(result.value.votes.rows).toHaveLength(3);
    }
  });

  it("uses the authoritative Poll Type and rejects a legacy-shaped Ballot", async () => {
    const deps: CastVoteDeps = {
      findPoll: async () => rankedPoll(),
      findVoteBySubmission: async () => null,
      strategyFor: votingStrategyFor,
      createDigest: async () => {
        throw new Error("not used");
      },
      hashPayload: async (payload) => payload,
      persistVote: async () => {
        throw new Error("must not persist");
      },
      generateId: () => "ranked-vote",
      nowMs: () => NOW,
    };
    await expect(
      castVote(deps, {
        ...rankedInput([]),
        pollType: "multiple_choice",
        selectedOptionIds: [OPTION_A],
        rankedPreferences: undefined,
      }),
    ).resolves.toEqual({
      ok: false,
      error: expect.objectContaining({ code: "invalid_ranking" }),
    });
  });
});
