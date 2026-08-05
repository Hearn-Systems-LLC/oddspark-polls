import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createOwnerExportPersistence,
} from "../../src/adapters/d1/index";
import {
  createMultipleChoiceExportFactDriver,
  MULTIPLE_CHOICE_EXPORT_PROJECTION_QUERY,
} from "../../src/adapters/d1/export/multiple-choice";
import { multipleChoiceStrategy } from "../../src/modules/polls/types/multiple-choice";
import {
  bindExportDriver,
  queryOwnerExport,
} from "../../src/modules/results/export";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";

type TestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;
const OWNER = "csv-owner" as UserId;
const OTHER_OWNER = "csv-other-owner" as UserId;
const POLL = "csv-poll" as PollId;
const OTHER_POLL = "csv-other-poll" as PollId;
const A = "csv-option-a" as PollOptionId;
const B = "csv-option-b" as PollOptionId;
const C = "csv-option-c" as PollOptionId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM vote_comment").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  for (const [id, email] of [
    [OWNER, "csv-owner@example.test"],
    [OTHER_OWNER, "csv-other@example.test"],
  ] as const) {
    await testEnv.DB.prepare(
      "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'CSV Creator', ?2, 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
    )
      .bind(id, email)
      .run();
  }
  await seedPoll(POLL, OWNER, "csv-rich");
});

async function seedPoll(
  pollId: PollId,
  owner: UserId,
  reference: string,
  options: readonly (readonly [PollOptionId, string, number])[] = [
    [B, "Beta, quoted \"choice\"", 1],
    [A, "Alpha", 0],
    [C, "=Formula option", 2],
  ],
): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO poll (
        id, owner_user_id, poll_type, question, result_visibility,
        comments_enabled, multi_select_enabled, representation_version,
        created_at_ms, updated_at_ms
      ) VALUES (?1, ?2, 'multiple_choice', 'Export?', 'creator_only',
        1, 1, 1, 0, 0)`,
    ).bind(pollId, owner),
    ...options.map(([id, label, position]) =>
      testEnv.DB.prepare(
        "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, ?3, ?4, 0)",
      ).bind(id, pollId, label, position),
    ),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'custom', 1, 0)",
    ).bind(reference, pollId),
  ]);
}

async function seedVote(
  id: string,
  createdAtMs: number,
  selections: PollOptionId[],
  comment?: { body: string; displayName: string | null },
): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(
      id,
      POLL,
      `submission-enforcement-${id}`,
      `payload-enforcement-${id}`,
      createdAtMs,
    ),
    ...selections.map((optionId) =>
      testEnv.DB.prepare(
        "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
      ).bind(id, optionId),
    ),
    ...(comment
      ? [
          testEnv.DB.prepare(
            "INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
          ).bind(
            `comment-enforcement-${id}`,
            id,
            comment.body,
            comment.displayName,
            createdAtMs,
          ),
        ]
      : []),
    testEnv.DB.prepare(
      "INSERT INTO voter_claim (poll_id, check_kind, digest, vote_id, created_at_ms) VALUES (?1, 'session', ?2, ?3, ?4)",
    ).bind(POLL, id.padEnd(64, "a").slice(0, 64), id, createdAtMs),
  ]);
}

describe("owner CSV export D1 adapter", () => {
  it("loads a minimal owner envelope and conceals foreign and missing Polls identically", async () => {
    const persistence = createOwnerExportPersistence(testEnv.DB);
    await expect(persistence.findOwnerEnvelope(POLL, OWNER)).resolves.toEqual({
      pollId: POLL,
      pollType: "multiple_choice",
      canonicalReference: "csv-rich",
    });
    await expect(
      persistence.findOwnerEnvelope(POLL, OTHER_OWNER),
    ).resolves.toBeNull();
    await expect(
      persistence.findOwnerEnvelope("missing" as PollId, OWNER),
    ).resolves.toBeNull();
    await testEnv.DB.prepare(
      "UPDATE poll_reference SET reference = '-csv-rich-' WHERE poll_id = ?1",
    )
      .bind(POLL)
      .run();
    await expect(persistence.findOwnerEnvelope(POLL, OWNER)).resolves.toEqual({
      pollId: POLL,
      pollType: "multiple_choice",
      canonicalReference: "-csv-rich-",
    });
    await testEnv.DB.prepare("DELETE FROM poll_reference WHERE poll_id = ?1")
      .bind(POLL)
      .run();
    await expect(persistence.findOwnerEnvelope(POLL, OWNER)).rejects.toThrow(
      "Malformed export owner envelope",
    );
  });

  it("projects empty option/Tally facts from one statement with zero counts", async () => {
    const preparedStatements: string[] = [];
    const countingDb = {
      prepare(sql: string) {
        preparedStatements.push(sql);
        return testEnv.DB.prepare(sql);
      },
    } as D1Database;
    const facts = await createMultipleChoiceExportFactDriver(countingDb).projectFacts(
      POLL,
    );
    expect(preparedStatements).toEqual([MULTIPLE_CHOICE_EXPORT_PROJECTION_QUERY]);
    expect(facts).toMatchObject({
      sharedVotes: [],
      typeFacts: {
        multiSelectEnabled: true,
        minSelections: null,
        maxSelections: null,
        voterCount: 0,
        selectionCount: 0,
        votes: [],
        options: [
          { label: "Alpha", position: 0, count: 0 },
          { label: "Beta, quoted \"choice\"", position: 1, count: 0 },
          { label: "=Formula option", position: 2, count: 0 },
        ],
      },
    });
  });

  it("keeps multi-select, Comment, deterministic ties, and complete Tally coherent", async () => {
    await seedVote("vote-z", 1_800_000_000_000, [B, A], {
      body: "first line\nsecond, \"quoted\" line",
      displayName: "Zoë",
    });
    await seedVote("vote-a", 1_800_000_000_000, [C]);
    const persistence = createOwnerExportPersistence(testEnv.DB);
    const factDriver = createMultipleChoiceExportFactDriver(testEnv.DB);
    const facts = await factDriver.projectFacts(POLL);
    expect(facts).toEqual({
      sharedVotes: [
        {
          alignmentKey: 0,
          createdAtMs: 1_800_000_000_000,
          comment: null,
        },
        {
          alignmentKey: 1,
          createdAtMs: 1_800_000_000_000,
          comment: {
            body: "first line\nsecond, \"quoted\" line",
            displayName: "Zoë",
            createdAtMs: 1_800_000_000_000,
          },
        },
      ],
      typeFacts: {
        multiSelectEnabled: true,
        minSelections: null,
        maxSelections: null,
        options: [
          { label: "Alpha", position: 0, count: 1 },
          { label: "Beta, quoted \"choice\"", position: 1, count: 1 },
          { label: "=Formula option", position: 2, count: 1 },
        ],
        votes: [
          {
            alignmentKey: 0,
            createdAtMs: 1_800_000_000_000,
            selections: [{ optionPosition: 2 }],
          },
          {
            alignmentKey: 1,
            createdAtMs: 1_800_000_000_000,
            selections: [{ optionPosition: 0 }, { optionPosition: 1 }],
          },
        ],
        voterCount: 2,
        selectionCount: 3,
      },
    });

    const dataset = await queryOwnerExport(persistence, POLL, { userId: OWNER }, [
      bindExportDriver(factDriver, multipleChoiceStrategy),
    ]);
    expect(dataset?.dataset.votes.rows.map((row) => row.slice(-3))).toEqual([
      ["=Formula option", "", ""],
      ["Alpha", "Beta, quoted \"choice\"", ""],
    ]);
  });

  it("exports a valid single-select Poll with multiline option labels", async () => {
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "UPDATE poll SET multi_select_enabled = 0 WHERE id = ?1",
      ).bind(POLL),
      testEnv.DB.prepare(
        "UPDATE poll_option SET label = ?1 WHERE id = ?2",
      ).bind("Alpha\nline", A),
    ]);
    await seedVote("vote-single", 1_800_000_000_000, [A]);
    const factDriver = createMultipleChoiceExportFactDriver(testEnv.DB);
    const result = await queryOwnerExport(
      createOwnerExportPersistence(testEnv.DB),
      POLL,
      { userId: OWNER },
      [bindExportDriver(factDriver, multipleChoiceStrategy)],
    );
    expect(result?.dataset.votes.columns).toEqual([
      "TIMESTAMP",
      "DISPLAY NAME",
      "COMMENT",
      "SELECTION 1",
    ]);
    expect(result?.dataset.votes.rows).toEqual([
      ["2027-01-15T08:00:00.000Z", "", "", "Alpha\nline"],
    ]);
    expect(result?.dataset.tally.rows).toContainEqual(["Alpha\nline", 1]);
    expect(result?.dataset.summary.rows).toEqual([
      ["VOTERS", 1],
      ["SELECTIONS", 1],
    ]);
  });

  it("never selects or returns enforcement identities", async () => {
    await seedVote("vote-private", 1_800_000_000_000, [A]);
    const raw = await createMultipleChoiceExportFactDriver(testEnv.DB).projectFacts(POLL);
    const serialized = JSON.stringify(raw);
    expect(MULTIPLE_CHOICE_EXPORT_PROJECTION_QUERY).not.toMatch(
      /submission_id|payload_hash|voter_claim|digest|owner_user_id|reference/iu,
    );
    for (const sentinel of [
      "submission-enforcement-vote-private",
      "payload-enforcement-vote-private",
      "comment-enforcement-vote-private",
      "vote-privateaaaaaaaa",
    ]) {
      expect(serialized).not.toContain(sentinel);
    }
    for (const internalId of [POLL, A, B, C, "vote-private"]) {
      expect(serialized).not.toContain(internalId);
    }
  });

  it("fails closed for a non-canonical persisted option label", async () => {
    await testEnv.DB.prepare("UPDATE poll_option SET label = ' Alpha' WHERE id = ?1")
      .bind(A)
      .run();
    const factDriver = createMultipleChoiceExportFactDriver(testEnv.DB);
    await expect(
      queryOwnerExport(
        createOwnerExportPersistence(testEnv.DB),
        POLL,
        { userId: OWNER },
        [bindExportDriver(factDriver, multipleChoiceStrategy)],
      ),
    ).rejects.toThrow();
  });

  it("fails closed when a selection points at a foreign Poll option", async () => {
    await seedVote("vote-corrupt", 1_800_000_000_000, [A]);
    await seedPoll(OTHER_POLL, OTHER_OWNER, "csv-other", [
      ["csv-other-a" as PollOptionId, "Other A", 10],
      ["csv-other-b" as PollOptionId, "Other B", 11],
    ]);
    await testEnv.DB.prepare("UPDATE poll_option SET poll_id = ?1 WHERE id = ?2")
      .bind(OTHER_POLL, A)
      .run();
    const persistence = createOwnerExportPersistence(testEnv.DB);
    const factDriver = createMultipleChoiceExportFactDriver(testEnv.DB);
    await expect(
      queryOwnerExport(persistence, POLL, { userId: OWNER }, [
        bindExportDriver(factDriver, multipleChoiceStrategy),
      ]),
    ).rejects.toThrow();
  });

  it("returns only internally coherent before-or-after snapshots during a concurrent Vote", async () => {
    const factDriver = createMultipleChoiceExportFactDriver(testEnv.DB);
    const [projection] = await Promise.all([
      factDriver.projectFacts(POLL),
      seedVote("vote-race", 1_800_000_000_000, [A, B]),
    ]);
    expect(projection).not.toBeNull();
    expect([0, 1]).toContain(projection!.typeFacts.voterCount);
    expect(projection!.typeFacts.selectionCount).toBe(projection!.typeFacts.voterCount * 2);
    expect(
      projection!.typeFacts.options.reduce((sum, option) => sum + option.count, 0),
    ).toBe(projection!.typeFacts.selectionCount);
    expect(projection!.sharedVotes).toHaveLength(projection!.typeFacts.voterCount);
  });
});
