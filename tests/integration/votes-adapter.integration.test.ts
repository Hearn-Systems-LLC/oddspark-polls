import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVotePersistence } from "../../src/adapters/d1/index";
import {
  createVoteDigest,
  sha256Hex,
} from "../../src/adapters/digest/index";
import { multipleChoiceStrategy } from "../../src/modules/polls/types/multiple-choice";
import {
  AlreadyVotedError,
  asVoterClaimDigest,
  PollClosedError,
  PollGoneError,
  SubmissionReplayError,
  castVote,
  type CastVoteDeps,
  type VotePersistenceBatch,
  type VoterClaimCheckKind,
  type VoterClaimDigest,
  type VotingPollTypeStrategy,
} from "../../src/modules/voting/index";
import { incrementRepresentationVersion } from "../../src/shared/application/index";
import type {
  PollId,
  PollOptionId,
} from "../../src/shared/domain/index";

/** Deterministic lowercase 64-hex claim digest for D1 fixtures. */
function fixtureDigest(seed: string): VoterClaimDigest {
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

const DIGEST_1 = fixtureDigest("digest-1");
const DIGEST_SESSION_ALT = fixtureDigest("digest-session-alt");
const DIGEST_IP = fixtureDigest("digest-ip");

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
    ipChecksEnabled?: boolean;
    maxSelections?: number | null;
    minSelections?: number | null;
    multiSelectEnabled?: boolean;
    sessionChecksEnabled?: boolean;
  } = {},
): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, session_checks_enabled, ip_checks_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, closed_at_ms, representation_version, created_at_ms, updated_at_ms) VALUES (?1, 'vote-adapter-owner', 'multiple_choice', 'Choose one', 'live', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, 0, 0)",
    ).bind(
      POLL_ID,
      overrides.sessionChecksEnabled === false ? 0 : 1,
      overrides.ipChecksEnabled === true ? 1 : 0,
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
        digest: DIGEST_1,
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
    createDigest: (digestInput) =>
      createVoteDigest("integration-vote-digest-secret", digestInput),
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
  ipDigest: null as VoterClaimDigest | null,
};

async function closePoll(): Promise<void> {
  await testEnv.DB.prepare("UPDATE poll SET closed_at_ms = ?1 WHERE id = ?2")
    .bind(NOW + 1, POLL_ID)
    .run();
}

function d1WithClaimClassificationRead(
  first: () => Promise<{ found: number } | null>,
): D1Database {
  // Deliberate failure-injection boundary: all writes use real D1, while only
  // the post-rollback claim-classification read is replaced.
  return {
    prepare(query: string) {
      if (query.startsWith("SELECT 1 AS found FROM voter_claim")) {
        return {
          bind: () => ({ first }),
        } as unknown as D1PreparedStatement;
      }
      return testEnv.DB.prepare(query);
    },
    batch: (statements: D1PreparedStatement[]) =>
      testEnv.DB.batch(statements),
  } as unknown as D1Database;
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
            digest: DIGEST_1,
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
              digest: DIGEST_1,
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
      ipChecksEnabled: false,
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
      persistence.findClaim(POLL_ID, "session", DIGEST_1),
    ).resolves.toBe(true);
    await expect(
      persistence.findClaim(POLL_ID, "session", DIGEST_SESSION_ALT),
    ).resolves.toBe(false);
    await expect(
      persistence.findClaim(
        POLL_ID,
        "session",
        "not-a-hex-digest" as unknown as VoterClaimDigest,
      ),
    ).resolves.toBe(false);
    await expect(
      persistence.findVoteSelectionByClaim(POLL_ID, "session", DIGEST_1),
    ).resolves.toEqual([OPTION_A]);
    await expect(
      persistence.findVoteSelectionByClaim(
        POLL_ID,
        "session",
        DIGEST_SESSION_ALT,
      ),
    ).resolves.toEqual([]);
    await expect(
      persistence.findVoteSelectionByClaim(
        POLL_ID,
        "session",
        "hostile" as unknown as VoterClaimDigest,
      ),
    ).resolves.toEqual([]);
    await expect(
      persistence.findVoteSelectionByClaim(
        POLL_ID,
        "device" as unknown as VoterClaimCheckKind,
        DIGEST_1,
      ),
    ).resolves.toEqual([]);
  });

  it("rejects hostile claim reads before any D1 prepare or bind call", async () => {
    const bind = vi.fn();
    const prepare = vi.fn(() => ({ bind }));
    // Deliberate spy boundary; invalid branded-port values must return before
    // the adapter needs any other part of the D1Database surface.
    const persistence = createVotePersistence({
      prepare,
      batch: vi.fn(),
    } as unknown as D1Database);
    const hostileDigest = "not-a-claim-digest" as unknown as VoterClaimDigest;

    await expect(
      persistence.findClaim(POLL_ID, "session", hostileDigest),
    ).resolves.toBe(false);
    await expect(
      persistence.findVoteSelectionByClaim(
        POLL_ID,
        "session",
        hostileDigest,
      ),
    ).resolves.toEqual([]);

    expect(prepare).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
  });

  it("reads sequential Poll snapshots before and after IP Checks are enabled", async () => {
    await insertPoll({ ipChecksEnabled: false });
    const persistence = createVotePersistence(testEnv.DB);

    const before = await persistence.findPoll(POLL_ID);
    await testEnv.DB.prepare(
      "UPDATE poll SET ip_checks_enabled = 1, representation_version = representation_version + 1 WHERE id = ?1",
    )
      .bind(POLL_ID)
      .run();
    const after = await persistence.findPoll(POLL_ID);

    expect(before?.ipChecksEnabled).toBe(false);
    expect(after?.ipChecksEnabled).toBe(true);
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
              digest: DIGEST_1,
              voteId: "vote-2",
              createdAtMs: NOW,
            },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      name: "AlreadyVotedError",
      checkKind: "session",
    });
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("does not guess a claim cause when a collision cannot be confirmed", async () => {
    await insertPoll();
    await createVotePersistence(testEnv.DB).insertVote(batch());
    const persistence = createVotePersistence(
      d1WithClaimClassificationRead(async () => null),
    );

    await expect(
      persistence.insertVote(
        batch({
          vote: {
            ...batch().vote,
            id: "vote-unclassified",
            submissionId: "submission-unclassified",
          },
          contributions: [
            {
              kind: "vote_selection",
              voteId: "vote-unclassified",
              pollOptionId: OPTION_B,
            },
            {
              kind: "voter_claim",
              pollId: POLL_ID,
              checkKind: "session",
              digest: DIGEST_1,
              voteId: "vote-unclassified",
              createdAtMs: NOW,
            },
          ],
        }),
      ),
    ).rejects.toThrow("voter claim collision without confirmed candidate");
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("fails safely when the post-collision classification read fails", async () => {
    await insertPoll();
    await createVotePersistence(testEnv.DB).insertVote(batch());
    const persistence = createVotePersistence(
      d1WithClaimClassificationRead(async () => {
        throw new Error("classification read unavailable");
      }),
    );

    await expect(
      persistence.insertVote(
        batch({
          vote: {
            ...batch().vote,
            id: "vote-read-failure",
            submissionId: "submission-read-failure",
          },
          contributions: [
            {
              kind: "vote_selection",
              voteId: "vote-read-failure",
              pollOptionId: OPTION_B,
            },
            {
              kind: "voter_claim",
              pollId: POLL_ID,
              checkKind: "session",
              digest: DIGEST_1,
              voteId: "vote-read-failure",
              createdAtMs: NOW,
            },
          ],
        }),
      ),
    ).rejects.toThrow("voter claim collision could not be classified");
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
              digest: DIGEST_1,
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

  it("commits both Session and IP claims with one version bump when both toggles are on", async () => {
    await insertPoll({ sessionChecksEnabled: true, ipChecksEnabled: true });
    const deps = castVoteDeps();
    const ipDigest = await createVoteDigest("integration-vote-digest-secret", {
      pollId: POLL_ID,
      checkKind: "ip",
      token: "v4:203.0.113.8",
    });

    await expect(
      castVote(deps, { ...integratedCommand, ipDigest }),
    ).resolves.toMatchObject({
      ok: true,
      value: { existing: false },
    });
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 2,
      version: 2,
    });
    const kinds = await testEnv.DB.prepare(
      "SELECT check_kind, digest FROM voter_claim WHERE poll_id = ?1 ORDER BY check_kind",
    )
      .bind(POLL_ID)
      .all<{ check_kind: string; digest: string }>();
    expect(kinds.results.map((row) => row.check_kind)).toEqual(["ip", "session"]);
    for (const row of kinds.results) {
      expect(row.digest).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("rejects a second browser on the same network with the IP cause", async () => {
    await insertPoll({ sessionChecksEnabled: true, ipChecksEnabled: true });
    const deps = castVoteDeps();
    const ipDigest = await createVoteDigest("integration-vote-digest-secret", {
      pollId: POLL_ID,
      checkKind: "ip",
      token: "v4:203.0.113.8",
    });

    await expect(
      castVote(deps, {
        ...integratedCommand,
        browserToken: "browser-a",
        ipDigest,
      }),
    ).resolves.toMatchObject({ ok: true, value: { existing: false } });

    await expect(
      castVote(deps, {
        ...integratedCommand,
        submissionId: "integrated-submission-b",
        browserToken: "browser-b",
        ipDigest,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "already_voted_ip" },
    });
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 2,
      version: 2,
    });
  });

  it("rejects the same browser with the Session cause even when IP also collides", async () => {
    await insertPoll({ sessionChecksEnabled: true, ipChecksEnabled: true });
    const deps = castVoteDeps();
    const ipDigest = await createVoteDigest("integration-vote-digest-secret", {
      pollId: POLL_ID,
      checkKind: "ip",
      token: "v4:203.0.113.8",
    });

    await expect(
      castVote(deps, {
        ...integratedCommand,
        browserToken: "browser-a",
        ipDigest,
      }),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      castVote(deps, {
        ...integratedCommand,
        submissionId: "integrated-submission-retry",
        browserToken: "browser-a",
        ipDigest,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "already_voted" },
    });
  });

  it("allows two browsers behind one IP when only Session Checks are on", async () => {
    await insertPoll({ sessionChecksEnabled: true, ipChecksEnabled: false });
    const deps = castVoteDeps();
    const ipDigest = await createVoteDigest("integration-vote-digest-secret", {
      pollId: POLL_ID,
      checkKind: "ip",
      token: "v4:203.0.113.8",
    });

    await expect(
      castVote(deps, {
        ...integratedCommand,
        browserToken: "browser-a",
        ipDigest,
      }),
    ).resolves.toMatchObject({ ok: true, value: { existing: false } });
    await expect(
      castVote(deps, {
        ...integratedCommand,
        submissionId: "integrated-submission-b",
        browserToken: "browser-b",
        ipDigest,
      }),
    ).resolves.toMatchObject({ ok: true, value: { existing: false } });
    expect(await counts()).toEqual({
      votes: 2,
      selections: 2,
      claims: 2,
      version: 3,
    });
  });

  it("enforces IP Checks only after mid-Poll enablement without backfilling old Votes", async () => {
    await insertPoll({ sessionChecksEnabled: false, ipChecksEnabled: false });
    const deps = castVoteDeps();
    const ipDigest = await createVoteDigest("integration-vote-digest-secret", {
      pollId: POLL_ID,
      checkKind: "ip",
      token: "v4:203.0.113.20",
    });

    await expect(
      castVote(deps, {
        ...integratedCommand,
        submissionId: "before-ip-enable",
        browserToken: null,
        ipDigest,
      }),
    ).resolves.toMatchObject({ ok: true, value: { existing: false } });
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 0,
      version: 2,
    });

    await testEnv.DB.prepare(
      "UPDATE poll SET ip_checks_enabled = 1, representation_version = representation_version + 1 WHERE id = ?1",
    )
      .bind(POLL_ID)
      .run();

    await expect(
      castVote(deps, {
        ...integratedCommand,
        submissionId: "first-after-ip-enable",
        browserToken: null,
        ipDigest,
      }),
    ).resolves.toMatchObject({ ok: true, value: { existing: false } });
    await expect(
      castVote(deps, {
        ...integratedCommand,
        submissionId: "duplicate-after-ip-enable",
        browserToken: null,
        ipDigest,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "already_voted_ip" },
    });
    expect(await counts()).toEqual({
      votes: 2,
      selections: 2,
      claims: 1,
      version: 4,
    });
  });

  it("blocks two hosts in the same IPv6 /64 under IP Checks", async () => {
    await insertPoll({ sessionChecksEnabled: false, ipChecksEnabled: true });
    const deps = castVoteDeps();
    const claimA = await createVoteDigest("integration-vote-digest-secret", {
      pollId: POLL_ID,
      checkKind: "ip",
      token: "v6:20010db800000000",
    });
    // Same /64 claim token as host A — different full host is irrelevant for claims.
    const claimB = claimA;

    await expect(
      castVote(deps, {
        ...integratedCommand,
        browserToken: null,
        ipDigest: claimA,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      castVote(deps, {
        ...integratedCommand,
        submissionId: "integrated-submission-b",
        browserToken: null,
        ipDigest: claimB,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "already_voted_ip" },
    });
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("accepts hosts from distinct IPv6 /64 networks under IP Checks", async () => {
    await insertPoll({ sessionChecksEnabled: false, ipChecksEnabled: true });
    const deps = castVoteDeps();
    const claimA = await createVoteDigest("integration-vote-digest-secret", {
      pollId: POLL_ID,
      checkKind: "ip",
      token: "v6:20010db800000000",
    });
    const claimB = await createVoteDigest("integration-vote-digest-secret", {
      pollId: POLL_ID,
      checkKind: "ip",
      token: "v6:20010db800000001",
    });

    await expect(
      castVote(deps, {
        ...integratedCommand,
        submissionId: "ipv6-network-a",
        browserToken: null,
        ipDigest: claimA,
      }),
    ).resolves.toMatchObject({ ok: true, value: { existing: false } });
    await expect(
      castVote(deps, {
        ...integratedCommand,
        submissionId: "ipv6-network-b",
        browserToken: null,
        ipDigest: claimB,
      }),
    ).resolves.toMatchObject({ ok: true, value: { existing: false } });
    expect(await counts()).toEqual({
      votes: 2,
      selections: 2,
      claims: 2,
      version: 3,
    });
  });

  it("rejects a forged claim digest before any D1 write", async () => {
    await insertPoll();
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
              kind: "voter_claim",
              pollId: POLL_ID,
              checkKind: "session",
              digest: "raw-not-hex" as unknown as VoterClaimDigest,
              voteId: "vote-1",
              createdAtMs: NOW,
            },
          ],
        }),
      ),
    ).rejects.toThrow(/invalid voter claim digest/);
    expect(await counts()).toEqual({
      votes: 0,
      selections: 0,
      claims: 0,
      version: 1,
    });
  });

  it("makes zero D1 calls when a later voter claim is malformed", async () => {
    const bind = vi.fn();
    const prepare = vi.fn(() => ({ bind }));
    const executeBatch = vi.fn();
    // Deliberate spy boundary; the adapter must reject before requiring the
    // remainder of the D1Database surface.
    const persistence = createVotePersistence({
      prepare,
      batch: executeBatch,
    } as unknown as D1Database);

    await expect(
      persistence.insertVote(
        batch({
          contributions: [
            {
              kind: "voter_claim",
              pollId: POLL_ID,
              checkKind: "session",
              digest: DIGEST_1,
              voteId: "vote-1",
              createdAtMs: NOW,
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
              digest: "malformed-later-claim" as unknown as VoterClaimDigest,
              voteId: "vote-1",
              createdAtMs: NOW,
            },
          ],
        }),
      ),
    ).rejects.toThrow("invalid voter claim digest");
    expect(prepare).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(executeBatch).not.toHaveBeenCalled();
  });

  it("rolls back every loser fact when forced concurrent same-network Votes race", async () => {
    await insertPoll({ sessionChecksEnabled: true, ipChecksEnabled: true });
    let batchArrivals = 0;
    let releaseBatches: (() => void) | undefined;
    const bothBatchesReady = new Promise<void>((resolve) => {
      releaseBatches = resolve;
    });
    // Force both real transactions to arrive at D1 batch() before either can
    // start. This proves the UNIQUE boundary, not sequential preflight.
    const racingDb = {
      prepare: (query: string) => testEnv.DB.prepare(query),
      batch: async (statements: D1PreparedStatement[]) => {
        batchArrivals += 1;
        if (batchArrivals === 2) {
          releaseBatches?.();
        }
        await bothBatchesReady;
        return testEnv.DB.batch(statements);
      },
    } as unknown as D1Database;
    const racingPersistence = createVotePersistence(racingDb);
    const deps = castVoteDeps();
    const attemptedVoteIds = new Map<string, string>();
    deps.persistVote = async (persistBatch) => {
      attemptedVoteIds.set(
        persistBatch.vote.submissionId,
        persistBatch.vote.id,
      );
      return racingPersistence.insertVote(persistBatch);
    };
    const ipDigest = await createVoteDigest("integration-vote-digest-secret", {
      pollId: POLL_ID,
      checkKind: "ip",
      token: "v4:198.51.100.9",
    });

    const commands = [
      {
        ...integratedCommand,
        submissionId: "race-a",
        browserToken: "race-browser-a",
        ipDigest,
      },
      {
        ...integratedCommand,
        submissionId: "race-b",
        browserToken: "race-browser-b",
        ipDigest,
      },
    ];
    const outcomes = await Promise.all(
      commands.map((command) => castVote(deps, command)),
    );

    expect(batchArrivals).toBe(2);
    expect(outcomes.filter((r) => r.ok && !r.value.existing)).toHaveLength(1);
    expect(
      outcomes.filter((r) => !r.ok && r.error.code === "already_voted_ip"),
    ).toHaveLength(1);
    expect(await counts()).toEqual({
      votes: 1,
      selections: 1,
      claims: 2,
      version: 2,
    });

    const loserIndex = outcomes.findIndex(
      (outcome) => !outcome.ok && outcome.error.code === "already_voted_ip",
    );
    if (loserIndex < 0) {
      throw new Error("forced race produced no losing IP collision");
    }
    const loserVoteId = attemptedVoteIds.get(
      commands[loserIndex]?.submissionId ?? "",
    );
    if (!loserVoteId) {
      throw new Error("forced race did not capture the losing Vote id");
    }
    const [loserVote, loserSelection, loserSessionClaim] = await Promise.all([
      testEnv.DB.prepare("SELECT COUNT(*) AS n FROM vote WHERE id = ?1")
        .bind(loserVoteId)
        .first<{ n: number }>(),
      testEnv.DB.prepare(
        "SELECT COUNT(*) AS n FROM vote_selection WHERE vote_id = ?1",
      )
        .bind(loserVoteId)
        .first<{ n: number }>(),
      testEnv.DB.prepare(
        "SELECT COUNT(*) AS n FROM voter_claim WHERE vote_id = ?1 AND check_kind = 'session'",
      )
        .bind(loserVoteId)
        .first<{ n: number }>(),
    ]);
    expect({
      vote: loserVote?.n,
      selection: loserSelection?.n,
      sessionClaim: loserSessionClaim?.n,
    }).toEqual({ vote: 0, selection: 0, sessionClaim: 0 });

    const digests = await testEnv.DB.prepare(
      "SELECT digest FROM voter_claim WHERE poll_id = ?1",
    )
      .bind(POLL_ID)
      .all<{ digest: string }>();
    expect(digests.results).toHaveLength(2);
    for (const row of digests.results) {
      expect(row.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(row.digest).not.toContain("198.51.100");
    }
  });
});
