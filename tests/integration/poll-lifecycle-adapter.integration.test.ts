import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createPollPersistence,
  createVotePersistence,
} from "../../src/adapters/d1/index";
import {
  closePoll,
  deletePoll,
  updatePollDefinition,
  updatePollDescription,
  updatePollSecurityToggles,
  type PollPersistenceRows,
} from "../../src/modules/polls/index";
import { incrementRepresentationVersion } from "../../src/shared/application/index";
import {
  PollClosedError,
  PollDefinitionChangedError,
  PollGoneError,
  type VotePersistenceBatch,
} from "../../src/modules/voting/index";
import { asVoterClaimDigest } from "../../src/modules/voting/ip-address";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";

function fixtureDigest(seed: string) {
  let out = "";
  for (let i = 0; i < 64; i += 1) {
    out += (seed.charCodeAt(i % seed.length) % 16).toString(16);
  }
  const branded = asVoterClaimDigest(out);
  if (branded === null) throw new Error("fixture digest construction failed");
  return branded;
}

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_784_000_000_000;
const OWNER_A = "owner-a" as UserId;
const OWNER_B = "owner-b" as UserId;
const POLL_A = "poll-life-a" as PollId;
const POLL_B = "poll-life-b" as PollId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('owner-a', 'Creator A', 'owner-a@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('owner-b', 'Creator B', 'owner-b@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).run();
});

function pollRows(
  pollId: PollId,
  ownerUserId: UserId,
  overrides: {
    question?: string;
    description?: string | null;
    reference?: string;
  } = {},
): PollPersistenceRows {
  return {
    poll: {
      id: pollId,
      ownerUserId,
      pollType: "multiple_choice",
      question: overrides.question ?? `Question ${pollId}`,
      description: overrides.description ?? null,
      resultVisibility: "live",
      discoveryState: "unlisted",
      sessionChecksEnabled: true,
      ipChecksEnabled: false,
      voterCodesEnabled: false,
      captchaEnabled: false,
      vpnBlockingEnabled: false,
      commentsEnabled: false,
      multiSelectEnabled: false,
      minSelections: null,
      maxSelections: null,
      deadlineMs: null,
      representationVersion: 1,
      createdAtMs: NOW,
    },
    options: [
      {
        id: `${pollId}-opt-1` as PollOptionId,
        pollId,
        label: "A",
        position: 0,
        createdAtMs: NOW,
      },
      {
        id: `${pollId}-opt-2` as PollOptionId,
        pollId,
        label: "B",
        position: 1,
        createdAtMs: NOW,
      },
    ],
    reference: {
      reference: overrides.reference ?? `ref-${pollId}`,
      pollId,
      kind: "generated",
      createdAtMs: NOW,
    },
  };
}

async function insertVote(pollId: PollId, voteId: string): Promise<void> {
  await testEnv.DB.prepare(
    "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(voteId, pollId, `sub-${voteId}`, `hash-${voteId}`, NOW)
    .run();
}

async function versionOf(pollId: PollId): Promise<number> {
  const row = await testEnv.DB.prepare(
    "SELECT representation_version AS v FROM poll WHERE id = ?1",
  )
    .bind(pollId)
    .first<{ v: number }>();
  return row?.v ?? -1;
}

function voteBatch(
  pollId: PollId,
  optionId: PollOptionId,
  suffix: string,
  updatedAtMs = NOW + 500,
): VotePersistenceBatch {
  const voteId = `vote-${suffix}`;
  return {
    vote: {
      id: voteId,
      pollId,
      submissionId: `submission-${suffix}`,
      payloadHash: `payload-${suffix}`,
      createdAtMs: updatedAtMs,
    },
    contributions: [
      { kind: "vote_selection", voteId, pollOptionId: optionId },
      {
        kind: "voter_claim",
        pollId,
        checkKind: "session",
        digest: fixtureDigest(`digest-${suffix}`),
        voteId,
        createdAtMs: updatedAtMs,
      },
    ],
    representationVersion: incrementRepresentationVersion(pollId, updatedAtMs),
  };
}

describe("poll lifecycle D1 adapter (Story 1.12)", () => {
  it("closes an open Poll once and is idempotent thereafter", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));

    const first = await closePoll(
      {
        loadOwnedPoll: (id, owner) =>
          persistence.loadLifecycleForOwner(id, owner),
        closePoll: (input) => persistence.closePollForOwner(input),
        nowMs: () => NOW + 100,
      },
      POLL_A,
      OWNER_A,
    );
    expect(first.ok).toBe(true);
    expect(await versionOf(POLL_A)).toBe(2);

    const second = await closePoll(
      {
        loadOwnedPoll: (id, owner) =>
          persistence.loadLifecycleForOwner(id, owner),
        closePoll: (input) => persistence.closePollForOwner(input),
        nowMs: () => NOW + 200,
      },
      POLL_A,
      OWNER_A,
    );
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.kind).toBe("already_closed");
    }
    expect(await versionOf(POLL_A)).toBe(2);
    const row = await testEnv.DB.prepare(
      "SELECT closed_at_ms AS closed FROM poll WHERE id = ?1",
    )
      .bind(POLL_A)
      .first<{ closed: number }>();
    expect(row?.closed).toBe(NOW + 100);
  });

  it("conceals foreign-owner close and leave rows unchanged", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    const before = await versionOf(POLL_A);

    const result = await closePoll(
      {
        loadOwnedPoll: (id, owner) =>
          persistence.loadLifecycleForOwner(id, owner),
        closePoll: (input) => persistence.closePollForOwner(input),
        nowMs: () => NOW + 50,
      },
      POLL_A,
      OWNER_B,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_not_found");
    }
    expect(await versionOf(POLL_A)).toBe(before);
    const row = await testEnv.DB.prepare(
      "SELECT closed_at_ms AS closed FROM poll WHERE id = ?1",
    )
      .bind(POLL_A)
      .first<{ closed: number | null }>();
    expect(row?.closed).toBeNull();
  });

  it("replaces definition when no Votes exist and locks after a Vote", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));

    const updated = await updatePollDefinition(
      {
        loadOwnedPoll: (id, owner) =>
          persistence.loadLifecycleForOwner(id, owner),
        updateDefinition: (input) =>
          persistence.updateDefinitionForOwner(input),
        updateDescription: (input) =>
          persistence.updateDescriptionForOwner(input),
        generateId: () => crypto.randomUUID(),
        nowMs: () => NOW + 10,
      },
      POLL_A,
      OWNER_A,
      {
        question: "New question?",
        description: "Notes",
        options: ["Yes", "No", "Maybe"],
        multiSelect: "true",
        minSelections: "1",
        maxSelections: "2",
      },
    );
    expect(updated.ok).toBe(true);
    expect(await versionOf(POLL_A)).toBe(2);

    const options = await testEnv.DB.prepare(
      "SELECT label FROM poll_option WHERE poll_id = ?1 ORDER BY position",
    )
      .bind(POLL_A)
      .all<{ label: string }>();
    expect(options.results.map((r) => r.label)).toEqual([
      "Yes",
      "No",
      "Maybe",
    ]);

    await insertVote(POLL_A, "vote-1");
    const locked = await updatePollDefinition(
      {
        loadOwnedPoll: (id, owner) =>
          persistence.loadLifecycleForOwner(id, owner),
        updateDefinition: (input) =>
          persistence.updateDefinitionForOwner(input),
        updateDescription: (input) =>
          persistence.updateDescriptionForOwner(input),
        generateId: () => crypto.randomUUID(),
        nowMs: () => NOW + 20,
      },
      POLL_A,
      OWNER_A,
      {
        question: "Should not land",
        description: "Notes",
        options: ["X", "Y"],
        multiSelect: "false",
        minSelections: "",
        maxSelections: "",
      },
    );
    expect(locked.ok).toBe(false);
    if (!locked.ok) {
      expect(locked.error.code).toBe("poll_definition_locked");
    }
    const after = await testEnv.DB.prepare(
      "SELECT question FROM poll WHERE id = ?1",
    )
      .bind(POLL_A)
      .first<{ question: string }>();
    expect(after?.question).toBe("New question?");
    expect(await versionOf(POLL_A)).toBe(2);
  });

  it("allows description updates after Votes and after close", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    await insertVote(POLL_A, "vote-desc");
    await persistence.closePollForOwner({
      pollId: POLL_A,
      ownerUserId: OWNER_A,
      version: incrementRepresentationVersion(POLL_A, NOW + 5),
    });

    const result = await updatePollDescription(
      {
        loadOwnedPoll: (id, owner) =>
          persistence.loadLifecycleForOwner(id, owner),
        updateDescription: (input) =>
          persistence.updateDescriptionForOwner(input),
        nowMs: () => NOW + 30,
      },
      POLL_A,
      OWNER_A,
      "Post-close notes",
    );
    expect(result.ok).toBe(true);
    const row = await testEnv.DB.prepare(
      "SELECT description FROM poll WHERE id = ?1",
    )
      .bind(POLL_A)
      .first<{ description: string }>();
    expect(row?.description).toBe("Post-close notes");
  });

  it("hard-deletes the Poll and cascades children so the reference is re-claimable", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      pollRows(POLL_A, OWNER_A, { reference: "team-lunch" }),
    );
    await insertVote(POLL_A, "vote-del");
    await testEnv.DB.prepare(
      "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
    )
      .bind("vote-del", `${POLL_A}-opt-1`)
      .run();
    await testEnv.DB.prepare(
      "INSERT INTO voter_claim (poll_id, check_kind, digest, vote_id, created_at_ms) VALUES (?1, 'session', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', ?2, ?3)",
    )
      .bind(POLL_A, "vote-del", NOW)
      .run();

    const result = await deletePoll(
      {
        loadOwnedPoll: (id, owner) =>
          persistence.loadLifecycleForOwner(id, owner),
        deletePoll: (input) => persistence.deletePollForOwner(input),
      },
      POLL_A,
      OWNER_A,
    );
    expect(result.ok).toBe(true);

    const poll = await testEnv.DB.prepare(
      "SELECT id FROM poll WHERE id = ?1",
    )
      .bind(POLL_A)
      .first();
    expect(poll).toBeNull();
    const options = await testEnv.DB.prepare(
      "SELECT id FROM poll_option WHERE poll_id = ?1",
    )
      .bind(POLL_A)
      .all();
    expect(options.results).toHaveLength(0);
    const votes = await testEnv.DB.prepare(
      "SELECT id FROM vote WHERE poll_id = ?1",
    )
      .bind(POLL_A)
      .all();
    expect(votes.results).toHaveLength(0);
    const selections = await testEnv.DB.prepare(
      "SELECT vote_id FROM vote_selection WHERE vote_id = 'vote-del'",
    ).all();
    expect(selections.results).toHaveLength(0);
    const claims = await testEnv.DB.prepare(
      "SELECT vote_id FROM voter_claim WHERE poll_id = ?1",
    )
      .bind(POLL_A)
      .all();
    expect(claims.results).toHaveLength(0);
    const refs = await testEnv.DB.prepare(
      "SELECT reference FROM poll_reference WHERE reference = 'team-lunch'",
    ).all();
    expect(refs.results).toHaveLength(0);

    // Re-claim the custom reference.
    await persistence.insertPoll(
      pollRows(POLL_B, OWNER_A, { reference: "team-lunch" }),
    );
    const reclaimed = await persistence.findPollByReference("team-lunch");
    expect(reclaimed?.pollId).toBe(POLL_B);
  });

  it("Vote-first definition edit leaves every row and version unchanged", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    await insertVote(POLL_A, "vote-race");
    const beforeVersion = await versionOf(POLL_A);
    const beforeOptions = await testEnv.DB.prepare(
      "SELECT id, label FROM poll_option WHERE poll_id = ?1 ORDER BY position",
    )
      .bind(POLL_A)
      .all();

    const result = await persistence.updateDefinitionForOwner({
      pollId: POLL_A,
      ownerUserId: OWNER_A,
      definition: {
        question: "Race?",
        description: null,
        options: [
          { label: "X", position: 0 },
          { label: "Y", position: 1 },
        ],
        multiSelect: false,
        minSelections: null,
        maxSelections: null,
        commentsEnabled: false,
      },
      options: [
        {
          id: "new-1" as PollOptionId,
          label: "X",
          position: 0,
        },
        {
          id: "new-2" as PollOptionId,
          label: "Y",
          position: 1,
        },
      ],
      expectedRepresentationVersion: beforeVersion,
      version: incrementRepresentationVersion(POLL_A, NOW + 99),
    });
    expect(result).toBe("locked");
    expect(await versionOf(POLL_A)).toBe(beforeVersion);
    const afterOptions = await testEnv.DB.prepare(
      "SELECT id, label FROM poll_option WHERE poll_id = ?1 ORDER BY position",
    )
      .bind(POLL_A)
      .all();
    expect(afterOptions.results).toEqual(beforeOptions.results);
  });

  it("keeps a same-value description race idempotent at the D1 boundary", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      pollRows(POLL_A, OWNER_A, { description: "Old notes" }),
    );

    await expect(
      persistence.updateDescriptionForOwner({
        pollId: POLL_A,
        ownerUserId: OWNER_A,
        description: "New notes",
        version: incrementRepresentationVersion(POLL_A, NOW + 10),
      }),
    ).resolves.toBe("updated");
    await expect(
      persistence.updateDescriptionForOwner({
        pollId: POLL_A,
        ownerUserId: OWNER_A,
        description: "New notes",
        version: incrementRepresentationVersion(POLL_A, NOW + 20),
      }),
    ).resolves.toBe("unchanged");

    expect(await versionOf(POLL_A)).toBe(2);
    await expect(
      testEnv.DB.prepare(
        "SELECT description, updated_at_ms FROM poll WHERE id = ?1",
      )
        .bind(POLL_A)
        .first(),
    ).resolves.toEqual({
      description: "New notes",
      updated_at_ms: NOW + 10,
    });
  });

  it("rejects stale, unsupported, and foreign-owner definition batches without changing rows", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    const definition = {
      question: "First editor won",
      description: null,
      options: [
        { label: "One", position: 0 },
        { label: "Two", position: 1 },
      ],
      multiSelect: false,
      minSelections: null,
      maxSelections: null,
      commentsEnabled: false,
    };
    const firstOptions = [
      { id: "first-1" as PollOptionId, label: "One", position: 0 },
      { id: "first-2" as PollOptionId, label: "Two", position: 1 },
    ];

    await expect(
      persistence.updateDefinitionForOwner({
        pollId: POLL_A,
        ownerUserId: OWNER_A,
        definition,
        options: firstOptions,
        expectedRepresentationVersion: 1,
        version: incrementRepresentationVersion(POLL_A, NOW + 10),
      }),
    ).resolves.toBe("updated");
    await expect(
      persistence.updateDefinitionForOwner({
        pollId: POLL_A,
        ownerUserId: OWNER_A,
        definition: { ...definition, question: "Stale overwrite" },
        options: [
          { id: "stale-1" as PollOptionId, label: "X", position: 0 },
          { id: "stale-2" as PollOptionId, label: "Y", position: 1 },
        ],
        expectedRepresentationVersion: 1,
        version: incrementRepresentationVersion(POLL_A, NOW + 20),
      }),
    ).resolves.toBe("conflict");
    await expect(
      persistence.updateDefinitionForOwner({
        pollId: POLL_A,
        ownerUserId: OWNER_B,
        definition: { ...definition, question: "Foreign overwrite" },
        options: firstOptions,
        expectedRepresentationVersion: 2,
        version: incrementRepresentationVersion(POLL_A, NOW + 30),
      }),
    ).resolves.toBe("not_found");
    await expect(
      persistence.deletePollForOwner({
        pollId: POLL_A,
        ownerUserId: OWNER_B,
      }),
    ).resolves.toBe("not_found");

    const stored = await persistence.loadLifecycleForOwner(POLL_A, OWNER_A);
    expect(stored).toMatchObject({
      pollType: "multiple_choice",
      question: "First editor won",
      representationVersion: 2,
      options: firstOptions,
    });

    await persistence.insertPoll(pollRows(POLL_B, OWNER_A));
    await testEnv.DB.prepare(
      "UPDATE poll SET poll_type = 'image' WHERE id = ?1",
    )
      .bind(POLL_B)
      .run();
    await expect(
      persistence.updateDefinitionForOwner({
        pollId: POLL_B,
        ownerUserId: OWNER_A,
        definition,
        options: firstOptions,
        expectedRepresentationVersion: 1,
        version: incrementRepresentationVersion(POLL_B, NOW + 40),
      }),
    ).resolves.toBe("unsupported");
    expect(await versionOf(POLL_B)).toBe(1);
  });

  it("maps a definition-edit-first stale ballot and preserves only the edit increment", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    const votePersistence = createVotePersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    const oldOption = `${POLL_A}-opt-1` as PollOptionId;

    await expect(
      persistence.updateDefinitionForOwner({
        pollId: POLL_A,
        ownerUserId: OWNER_A,
        definition: {
          question: "Edited first",
          description: null,
          options: [
            { label: "New A", position: 0 },
            { label: "New B", position: 1 },
          ],
          multiSelect: false,
          minSelections: null,
          maxSelections: null,
          commentsEnabled: false,
        },
        options: [
          { id: "edited-1" as PollOptionId, label: "New A", position: 0 },
          { id: "edited-2" as PollOptionId, label: "New B", position: 1 },
        ],
        expectedRepresentationVersion: 1,
        version: incrementRepresentationVersion(POLL_A, NOW + 10),
      }),
    ).resolves.toBe("updated");
    await expect(
      votePersistence.insertVote(voteBatch(POLL_A, oldOption, "stale")),
    ).rejects.toBeInstanceOf(PollDefinitionChangedError);

    expect(await versionOf(POLL_A)).toBe(2);
    const votes = await testEnv.DB.prepare(
      "SELECT id FROM vote WHERE poll_id = ?1",
    )
      .bind(POLL_A)
      .all();
    expect(votes.results).toHaveLength(0);
  });

  it("proves both Vote and close serializations without partial facts", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    const votePersistence = createVotePersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    const optionA = `${POLL_A}-opt-1` as PollOptionId;

    await votePersistence.insertVote(voteBatch(POLL_A, optionA, "vote-first"));
    await expect(
      persistence.closePollForOwner({
        pollId: POLL_A,
        ownerUserId: OWNER_A,
        version: incrementRepresentationVersion(POLL_A, NOW + 600),
      }),
    ).resolves.toBe("closed");
    const voteFirstCount = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM vote WHERE poll_id = ?1",
    )
      .bind(POLL_A)
      .first<{ n: number }>();
    expect(voteFirstCount?.n).toBe(1);

    await persistence.insertPoll(pollRows(POLL_B, OWNER_A));
    await persistence.closePollForOwner({
      pollId: POLL_B,
      ownerUserId: OWNER_A,
      version: incrementRepresentationVersion(POLL_B, NOW + 700),
    });
    await expect(
      votePersistence.insertVote(
        voteBatch(
          POLL_B,
          `${POLL_B}-opt-1` as PollOptionId,
          "close-first",
          NOW + 800,
        ),
      ),
    ).rejects.toBeInstanceOf(PollClosedError);
  });

  it("proves both Vote and delete serializations without partial facts", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    const votePersistence = createVotePersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    await votePersistence.insertVote(
      voteBatch(
        POLL_A,
        `${POLL_A}-opt-1` as PollOptionId,
        "vote-delete",
      ),
    );
    await expect(
      persistence.deletePollForOwner({
        pollId: POLL_A,
        ownerUserId: OWNER_A,
      }),
    ).resolves.toBe("deleted");
    await expect(
      testEnv.DB.prepare("SELECT id FROM vote WHERE poll_id = ?1")
        .bind(POLL_A)
        .all(),
    ).resolves.toMatchObject({ results: [] });

    await persistence.insertPoll(pollRows(POLL_B, OWNER_A));
    const staleVote = voteBatch(
      POLL_B,
      `${POLL_B}-opt-1` as PollOptionId,
      "delete-first",
    );
    await persistence.deletePollForOwner({
      pollId: POLL_B,
      ownerUserId: OWNER_A,
    });
    await expect(votePersistence.insertVote(staleVote)).rejects.toBeInstanceOf(
      PollGoneError,
    );
  });
});


describe("updateSecurityTogglesForOwner (Story 2.1)", () => {
  const defaultToggles = {
    sessionChecks: true,
    ipChecks: false,
    voterCodes: false,
    captcha: false,
    vpnBlocking: false,
  } as const;

  it("persists all five toggle columns on insert and round-trips them", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    const rows = pollRows(POLL_A, OWNER_A);
    rows.poll.sessionChecksEnabled = false;
    rows.poll.ipChecksEnabled = true;
    rows.poll.captchaEnabled = true;
    await persistence.insertPoll(rows);

    const lifecycle = await persistence.loadLifecycleForOwner(POLL_A, OWNER_A);
    expect(lifecycle).toMatchObject({
      sessionChecksEnabled: false,
      ipChecksEnabled: true,
      voterCodesEnabled: false,
      captchaEnabled: true,
      vpnBlockingEnabled: false,
    });
    const owned = await persistence.findPollForOwner(POLL_A, OWNER_A);
    expect(owned).toMatchObject({
      sessionChecksEnabled: false,
      ipChecksEnabled: true,
      captchaEnabled: true,
    });
  });

  it("allows disable before any Vote and bumps representation_version", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    const result = await persistence.updateSecurityTogglesForOwner({
      pollId: POLL_A,
      ownerUserId: OWNER_A,
      toggles: { ...defaultToggles, sessionChecks: false, captcha: true },
      version: incrementRepresentationVersion(POLL_A, NOW + 1),
    });
    expect(result).toBe("updated");
    expect(await versionOf(POLL_A)).toBe(2);
    const lifecycle = await persistence.loadLifecycleForOwner(POLL_A, OWNER_A);
    expect(lifecycle?.sessionChecksEnabled).toBe(false);
    expect(lifecycle?.captchaEnabled).toBe(true);
  });

  it("allows enable after a Vote and leaves tally untouched", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    await insertVote(POLL_A, "vote-sec-1");
    const beforeVotes = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM vote WHERE poll_id = ?1",
    )
      .bind(POLL_A)
      .first<{ n: number }>();

    const result = await persistence.updateSecurityTogglesForOwner({
      pollId: POLL_A,
      ownerUserId: OWNER_A,
      toggles: { ...defaultToggles, captcha: true },
      version: incrementRepresentationVersion(POLL_A, NOW + 2),
    });
    expect(result).toBe("updated");
    const afterVotes = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM vote WHERE poll_id = ?1",
    )
      .bind(POLL_A)
      .first<{ n: number }>();
    expect(afterVotes?.n).toBe(beforeVotes?.n);
    const lifecycle = await persistence.loadLifecycleForOwner(POLL_A, OWNER_A);
    expect(lifecycle?.captchaEnabled).toBe(true);
    expect(lifecycle?.sessionChecksEnabled).toBe(true);
  });

  it("classifies post-vote disable as locked and leaves columns unchanged", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    await insertVote(POLL_A, "vote-sec-2");
    const beforeVersion = await versionOf(POLL_A);

    const result = await persistence.updateSecurityTogglesForOwner({
      pollId: POLL_A,
      ownerUserId: OWNER_A,
      toggles: { ...defaultToggles, sessionChecks: false },
      version: incrementRepresentationVersion(POLL_A, NOW + 3),
    });
    expect(result).toBe("locked");
    expect(await versionOf(POLL_A)).toBe(beforeVersion);
    const lifecycle = await persistence.loadLifecycleForOwner(POLL_A, OWNER_A);
    expect(lifecycle?.sessionChecksEnabled).toBe(true);
  });

  it("is unchanged with no version bump on a no-op write", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    const result = await persistence.updateSecurityTogglesForOwner({
      pollId: POLL_A,
      ownerUserId: OWNER_A,
      toggles: { ...defaultToggles },
      version: incrementRepresentationVersion(POLL_A, NOW + 4),
    });
    expect(result).toBe("unchanged");
    expect(await versionOf(POLL_A)).toBe(1);
  });

  it("command path maps locked adapter results to poll_security_locked", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows(POLL_A, OWNER_A));
    await insertVote(POLL_A, "vote-sec-cmd");
    const result = await updatePollSecurityToggles(
      {
        loadOwnedPoll: (pollId, ownerUserId) =>
          persistence.loadLifecycleForOwner(pollId, ownerUserId),
        updateSecurityToggles: (input) =>
          persistence.updateSecurityTogglesForOwner(input),
        nowMs: () => NOW + 5,
      },
      POLL_A,
      OWNER_A,
      { ...defaultToggles, sessionChecks: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_security_locked");
    }
  });
});
