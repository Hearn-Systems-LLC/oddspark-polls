import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createVotePersistence } from "../../src/adapters/d1/index";
import {
  createVoteDigest,
  sha256Hex,
} from "../../src/adapters/digest/index";
import { multipleChoiceStrategy } from "../../src/modules/polls/types/multiple-choice";
import {
  AlreadyVotedError,
  PollClosedError,
  PollGoneError,
  SubmissionReplayError,
  castVote,
  type CastVoteDeps,
  type VotePersistenceBatch,
  type VotingPollTypeStrategy,
} from "../../src/modules/voting/index";
import { incrementRepresentationVersion } from "../../src/shared/application/index";
import type {
  PollId,
  PollOptionId,
} from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_800_000_000_000;
const POLL_ID = "vote-adapter-poll" as PollId;
const OPTION_A = "vote-adapter-option-a" as PollOptionId;
const OPTION_B = "vote-adapter-option-b" as PollOptionId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('vote-adapter-owner', 'Creator', 'vote-adapter-owner@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).run();
});

async function insertPoll(
  overrides: {
    closedAtMs?: number;
    deadlineMs?: number;
    maxSelections?: number | null;
    minSelections?: number | null;
    multiSelectEnabled?: boolean;
    sessionChecksEnabled?: boolean;
  } = {},
): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, session_checks_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, closed_at_ms, representation_version, created_at_ms, updated_at_ms) VALUES (?1, 'vote-adapter-owner', 'multiple_choice', 'Choose one', 'live', ?2, ?3, ?4, ?5, ?6, ?7, 1, 0, 0)",
    ).bind(
      POLL_ID,
      overrides.sessionChecksEnabled === false ? 0 : 1,
      overrides.multiSelectEnabled === true ? 1 : 0,
      overrides.minSelections ?? null,
      overrides.maxSelections ?? null,
      overrides.deadlineMs ?? null,
      overrides.closedAtMs ?? null,
    ),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'A', 0, 0)",
    ).bind(OPTION_A, POLL_ID),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'B', 1, 0)",
    ).bind(OPTION_B, POLL_ID),
  ]);
}

function batch(
  overrides: Partial<VotePersistenceBatch> = {},
): VotePersistenceBatch {
  const voteId = overrides.vote?.id ?? "vote-1";
  return {
    vote: {
      id: voteId,
      pollId: POLL_ID,
      submissionId: "submission-1",
      payloadHash: "payload-hash-1",
      createdAtMs: NOW,
      ...overrides.vote,
    },
    contributions: overrides.contributions ?? [
      {
        kind: "vote_selection",
        voteId,
        pollOptionId: OPTION_A,
      },
      {
        kind: "voter_claim",
        pollId: POLL_ID,
        checkKind: "session",
        digest: "digest-1",
        voteId,
        createdAtMs: NOW,
      },
    ],
    representationVersion:
      overrides.representationVersion ??
      incrementRepresentationVersion(POLL_ID, NOW),
  };
}

async function counts(): Promise<{
  claims: number;
  selections: number;
  version: number | undefined;
  votes: number;
}> {
  const [votes, selections, claims, poll] = await Promise.all([
    testEnv.DB.prepare("SELECT COUNT(*) AS n FROM vote").first<{ n: number }>(),
    testEnv.DB.prepare("SELECT COUNT(*) AS n FROM vote_selection").first<{
      n: number;
    }>(),
    testEnv.DB.prepare("SELECT COUNT(*) AS n FROM voter_claim").first<{
      n: number;
    }>(),
    testEnv.DB.prepare(
      "SELECT representation_version FROM poll WHERE id = ?1",
    )
      .bind(POLL_ID)
      .first<{ representation_version: number }>(),
  ]);
  return {
    claims: claims?.n ?? -1,
    selections: selections?.n ?? -1,
    version: poll?.representation_version,
    votes: votes?.n ?? -1,
  };
}

function castVoteDeps(): CastVoteDeps {
  const persistence = createVotePersistence(testEnv.DB);
  let generated = 0;
  return {
    ...persistence,
    strategyFor: (): VotingPollTypeStrategy | null => {
      const { validateSubmission, persistFacts } = multipleChoiceStrategy;
      return persistFacts ? { validateSubmission, persistFacts } : null;
    },
    createDigest: (digestInput: {
      pollId: PollId;
      checkKind: "session";
      token: string;
    }) => createVoteDigest("integration-vote-digest-secret", digestInput),
    hashPayload: sha256Hex,
    persistVote: persistence.insertVote,
    generateId: () => `integrated-vote-${(generated += 1)}`,
    nowMs: () => NOW,
  };
}

const integratedCommand = {
  pollId: POLL_ID,
  submissionId: "integrated-submission",
  selectedOptionIds: [OPTION_A],
  browserToken: "browser-token",
};

async function closePoll(): Promise<void> {
  await testEnv.DB.prepare("UPDATE poll SET closed_at_ms = ?1 WHERE id = ?2")
    .bind(NOW + 1, POLL_ID)
    .run();
}

describe("createVotePersistence", () => {
  it("commits vote, selection, claim, and one representation increment in one batch", async () => {
    await insertPoll();
    const persistence = createVotePersistence(testEnv.DB);

    await persistence.insertVote(batch());

    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
    expect(
      await testEnv.DB.prepare(
        "SELECT updated_at_ms FROM poll WHERE id = ?1",
      )
        .bind(POLL_ID)
        .first(),
    ).toEqual({ updated_at_ms: NOW });
  });

  it("commits one multi-select vote, every selection, its claim, and one version increment atomically", async () => {
    await insertPoll({
      multiSelectEnabled: true,
      minSelections: 2,
      maxSelections: 2,
    });
    const persistence = createVotePersistence(testEnv.DB);
    await persistence.insertVote(
      batch({
        contributions: [
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
            digest: "digest-1",
            voteId: "vote-1",
            createdAtMs: NOW,
          },
        ],
      }),
    );

    expect(await counts()).toEqual({
      votes: 1,
      selections: 2,
      claims: 1,
      version: 2,
    });
    expect(
      await testEnv.DB.prepare(
        "SELECT poll_option_id FROM vote_selection WHERE vote_id = 'vote-1' ORDER BY poll_option_id",
      ).all(),
    ).toMatchObject({
      results: [
        { poll_option_id: OPTION_A },
        { poll_option_id: OPTION_B },
      ],
    });
  });

  it("rolls back the whole vote batch when one ballot duplicates an option id", async () => {
    await insertPoll({
      multiSelectEnabled: true,
      minSelections: 1,
      maxSelections: 2,
    });
    const persistence = createVotePersistence(testEnv.DB);

    await expect(
      persistence.insertVote(
        batch({
          contributions: [
            {
              kind: "vote_selection",
              voteId: "vote-1",
              pollOptionId: OPTION_A,
            },
            {
              kind: "vote_selection",
              voteId: "vote-1",
              pollOptionId: OPTION_A,
            },
            {
              kind: "voter_claim",
              pollId: POLL_ID,
              checkKind: "session",
              digest: "digest-1",
              voteId: "vote-1",
              createdAtMs: NOW,
            },
          ],
        }),
      ),
    ).rejects.toThrow();
    expect(await counts()).toEqual({
      votes: 0,
      selections: 0,
      claims: 0,
      version: 1,
    });
  });

  it("reads voting Poll facts, stored submissions, and duplicate claims", async () => {
    await insertPoll();
    const persistence = createVotePersistence(testEnv.DB);
    await persistence.insertVote(batch());

    await expect(persistence.findPoll(POLL_ID)).resolves.toEqual({
      id: POLL_ID,
      pollType: "multiple_choice",
      options: [
        { id: OPTION_A, label: "A", position: 0 },
        { id: OPTION_B, label: "B", position: 1 },
      ],
      sessionChecksEnabled: true,
      multiSelectEnabled: false,
      minSelections: null,
      maxSelections: null,
      deadlineMs: null,
      closedAtMs: null,
    });
    await expect(
      persistence.findVoteBySubmission(POLL_ID, "submission-1"),
    ).resolves.toEqual({
      voteId: "vote-1",
      payloadHash: "payload-hash-1",
      createdAtMs: NOW,
    });
    await expect(
      persistence.findClaim(POLL_ID, "session", "digest-1"),
    ).resolves.toBe(true);
    await expect(
      persistence.findClaim(POLL_ID, "session", "digest-missing"),
    ).resolves.toBe(false);
  });

  it("maps a second claim to AlreadyVotedError and rolls the batch back", async () => {
    await insertPoll();
    const persistence = createVotePersistence(testEnv.DB);
    await persistence.insertVote(batch());

    await expect(
      persistence.insertVote(
        batch({
          vote: {
            ...batch().vote,
            id: "vote-2",
            submissionId: "submission-2",
            payloadHash: "payload-hash-2",
          },
          contributions: [
            {
              kind: "vote_selection",
              voteId: "vote-2",
              pollOptionId: OPTION_B,
            },
            {
              kind: "voter_claim",
              pollId: POLL_ID,
              checkKind: "session",
              digest: "digest-1",
              voteId: "vote-2",
              createdAtMs: NOW,
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(AlreadyVotedError);
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("gives submission replay precedence when submission and claim both collide", async () => {
    await insertPoll();
    const persistence = createVotePersistence(testEnv.DB);
    await persistence.insertVote(batch());

    await expect(
      persistence.insertVote(
        batch({
          vote: { ...batch().vote, id: "vote-replay" },
          contributions: [
            {
              kind: "voter_claim",
              pollId: POLL_ID,
              checkKind: "session",
              digest: "digest-1",
              voteId: "vote-replay",
              createdAtMs: NOW,
            },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(SubmissionReplayError);
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("maps the closed-Poll trigger and rolls every fact back", async () => {
    await insertPoll({ closedAtMs: NOW - 1 });
    const persistence = createVotePersistence(testEnv.DB);

    await expect(persistence.insertVote(batch())).rejects.toBeInstanceOf(
      PollClosedError,
    );
    expect(await counts()).toEqual({
      votes: 0,
      selections: 0,
      claims: 0,
      version: 1,
    });
  });

  it("rolls the whole batch back when the Poll's deadline has already passed before the insert", async () => {
    await insertPoll({ deadlineMs: 1 });
    const persistence = createVotePersistence(testEnv.DB);

    await expect(persistence.insertVote(batch())).rejects.toBeInstanceOf(
      PollClosedError,
    );
    expect(await counts()).toEqual({
      votes: 0,
      selections: 0,
      claims: 0,
      version: 1,
    });
  });

  it("surfaces PollClosedError when a batch both collides on the claim and hits the closed trigger", async () => {
    await insertPoll();
    const persistence = createVotePersistence(testEnv.DB);
    await persistence.insertVote(batch());
    await closePoll();

    // The second batch carries the SAME claim digest — but the vote-row
    // trigger aborts before the claim insert runs.
    await expect(
      persistence.insertVote(
        batch({
          vote: {
            ...batch().vote,
            id: "vote-2",
            submissionId: "submission-2",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(PollClosedError);
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("surfaces PollClosedError before the submission unique check for a late replay", async () => {
    await insertPoll();
    const persistence = createVotePersistence(testEnv.DB);
    await persistence.insertVote(batch());
    await closePoll();

    // Same submission_id as the committed vote: the BEFORE-INSERT trigger
    // fires ahead of the unique constraint, so a voter whose vote WAS
    // recorded sees the closed error here — castVote re-reads to adjudicate.
    await expect(
      persistence.insertVote(
        batch({ vote: { ...batch().vote, id: "vote-replay" } }),
      ),
    ).rejects.toBeInstanceOf(PollClosedError);
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("rejects an extension contribution until its adapter rendering lands (Story 4.1/Epic 8)", async () => {
    await insertPoll();
    const persistence = createVotePersistence(testEnv.DB);

    await expect(
      persistence.insertVote(
        batch({
          contributions: [
            { kind: "extension:test", payload: { proof: "contributed" } },
          ],
        }),
      ),
    ).rejects.toThrow(/Unsupported vote contribution kind/);
    expect(await counts()).toEqual({
      votes: 0,
      selections: 0,
      claims: 0,
      version: 1,
    });
  });

  it("maps a vanished Poll FK and leaves no partial vote facts", async () => {
    await insertPoll();
    const persistence = createVotePersistence(testEnv.DB);
    await testEnv.DB.prepare("DELETE FROM poll WHERE id = ?1")
      .bind(POLL_ID)
      .run();

    await expect(persistence.insertVote(batch())).rejects.toBeInstanceOf(
      PollGoneError,
    );
    expect(await counts()).toEqual({
      votes: 0,
      selections: 0,
      claims: 0,
      version: undefined,
    });
  });
});

describe("castVote with the D1 adapter", () => {
  it("returns the stored outcome when an accepted multi-select ballot is replayed", async () => {
    await insertPoll({
      multiSelectEnabled: true,
      minSelections: 2,
      maxSelections: 2,
    });
    const deps = castVoteDeps();
    const command = {
      ...integratedCommand,
      selectedOptionIds: [OPTION_A, OPTION_B],
    };

    await expect(castVote(deps, command)).resolves.toMatchObject({
      ok: true,
      value: { existing: false, voteId: "integrated-vote-1" },
    });
    await expect(castVote(deps, command)).resolves.toMatchObject({
      ok: true,
      value: { existing: true, voteId: "integrated-vote-1" },
    });
    expect(await counts()).toEqual({
      votes: 1,
      selections: 2,
      claims: 1,
      version: 2,
    });
  });

  it("keeps the original committed outcome replayable after a divergent retry", async () => {
    await insertPoll();
    const deps = castVoteDeps();

    await expect(castVote(deps, integratedCommand)).resolves.toMatchObject({
      ok: true,
      value: { existing: false, voteId: "integrated-vote-1" },
    });
    await expect(castVote(deps, integratedCommand)).resolves.toMatchObject({
      ok: true,
      value: { existing: true, voteId: "integrated-vote-1" },
    });
    await expect(
      castVote(deps, {
        ...integratedCommand,
        selectedOptionIds: [OPTION_B],
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "idempotency_conflict" },
    });
    // A rejected edited-ballot retry does not poison the original idempotency
    // key: an exact replay still recovers the one stored outcome.
    await expect(castVote(deps, integratedCommand)).resolves.toMatchObject({
      ok: true,
      value: { existing: true, voteId: "integrated-vote-1" },
    });
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("counts exactly once when the same submission races itself", async () => {
    await insertPoll();
    const deps = castVoteDeps();
    // Instrument the real adapter: BOTH submissions must attempt a persist,
    // proving they raced past the pre-read and the loser's UNIQUE-collision
    // re-read produced the replay. Sequential scheduling would persist once
    // (the second pre-read would find the stored vote) and pass the outcome
    // assertions below without ever exercising the collision path.
    let persistAttempts = 0;
    const realPersistVote = deps.persistVote;
    deps.persistVote = async (persistBatch) => {
      persistAttempts += 1;
      return realPersistVote(persistBatch);
    };

    const outcomes = await Promise.all([
      castVote(deps, integratedCommand),
      castVote(deps, integratedCommand),
    ]);

    expect(persistAttempts).toBe(2);
    expect(outcomes.every((result) => result.ok)).toBe(true);
    expect(
      outcomes.filter((result) => result.ok && !result.value.existing),
    ).toHaveLength(1);
    expect(
      outcomes.filter((result) => result.ok && result.value.existing),
    ).toHaveLength(1);
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("returns the stored outcome for a replay that arrives after the Poll closed", async () => {
    await insertPoll();
    const deps = castVoteDeps();

    await expect(castVote(deps, integratedCommand)).resolves.toMatchObject({
      ok: true,
      value: { existing: false, voteId: "integrated-vote-1" },
    });
    await closePoll();

    await expect(castVote(deps, integratedCommand)).resolves.toMatchObject({
      ok: true,
      value: { existing: true, voteId: "integrated-vote-1" },
    });
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });
});
