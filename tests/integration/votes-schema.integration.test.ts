import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

async function insertPoll(
  suffix: string,
  state: {
    closedAtMs?: number;
    deadlineMs?: number;
  } = {},
): Promise<{ optionId: string; pollId: string }> {
  const userId = `vote-schema-user-${suffix}`;
  const pollId = `vote-schema-poll-${suffix}`;
  const optionId = `vote-schema-option-${suffix}`;

  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
    ).bind(
      userId,
      "Vote Schema Creator",
      `${userId}@example.test`,
      new Date(0).toISOString(),
    ),
    testEnv.DB.prepare(
      "INSERT OR IGNORE INTO poll (id, owner_user_id, poll_type, question, result_visibility, deadline_ms, closed_at_ms, created_at_ms, updated_at_ms) VALUES (?1, ?2, 'multiple_choice', 'Choose one', 'live', ?3, ?4, 0, 0)",
    ).bind(
      pollId,
      userId,
      state.deadlineMs ?? null,
      state.closedAtMs ?? null,
    ),
    testEnv.DB.prepare(
      "INSERT OR IGNORE INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Option', 0, 0)",
    ).bind(optionId, pollId),
  ]);

  return { optionId, pollId };
}

async function insertVote(
  pollId: string,
  suffix: string,
  submissionId = `submission-${suffix}`,
): Promise<string> {
  const voteId = `vote-${suffix}`;
  await testEnv.DB.prepare(
    "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, 0)",
  )
    .bind(voteId, pollId, submissionId, `hash-${suffix}`)
    .run();
  return voteId;
}

describe("voting D1 schema (migration 0006)", () => {
  it("creates vote facts with the required keys and lookup indexes", async () => {
    const tables = await testEnv.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    ).all<{ name: string }>();
    expect(tables.results.map(({ name }) => name)).toEqual(
      expect.arrayContaining(["vote", "vote_selection", "voter_claim"]),
    );

    const indexes = await testEnv.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name",
    ).all<{ name: string }>();
    expect(indexes.results.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "vote_poll_id_idx",
        "vote_poll_id_submission_id_idx",
        "voter_claim_vote_id_idx",
      ]),
    );

    const voteColumns = await testEnv.DB.prepare(
      "PRAGMA table_info('vote')",
    ).all<{ name: string; notnull: number; type: string }>();
    expect(voteColumns.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "id", notnull: 1, type: "TEXT" }),
        expect.objectContaining({ name: "poll_id", notnull: 1, type: "TEXT" }),
        expect.objectContaining({
          name: "submission_id",
          notnull: 1,
          type: "TEXT",
        }),
        expect.objectContaining({
          name: "payload_hash",
          notnull: 1,
          type: "TEXT",
        }),
        expect.objectContaining({
          name: "created_at_ms",
          notnull: 1,
          type: "INTEGER",
        }),
      ]),
    );
  });

  it("enforces submission idempotency and duplicate-claim uniqueness", async () => {
    const first = await insertPoll("unique-a");
    const second = await insertPoll("unique-b");
    const firstVoteId = await insertVote(
      first.pollId,
      "unique-a",
      "shared-submission",
    );

    await expect(
      insertVote(first.pollId, "unique-a-replay", "shared-submission"),
    ).rejects.toThrow(/UNIQUE/i);
    await expect(
      insertVote(second.pollId, "unique-b", "shared-submission"),
    ).resolves.toBe("vote-unique-b");

    await testEnv.DB.prepare(
      "INSERT INTO voter_claim (poll_id, check_kind, digest, vote_id, created_at_ms) VALUES (?1, 'session', 'digest-a', ?2, 0)",
    )
      .bind(first.pollId, firstVoteId)
      .run();
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO voter_claim (poll_id, check_kind, digest, vote_id, created_at_ms) VALUES (?1, 'session', 'digest-a', ?2, 0)",
      )
        .bind(first.pollId, firstVoteId)
        .run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY/i);
  });

  it("enforces selection keys and cascades deleted vote facts", async () => {
    const { optionId, pollId } = await insertPoll("selection");
    const voteId = await insertVote(pollId, "selection");

    await testEnv.DB.prepare(
      "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
    )
      .bind(voteId, optionId)
      .run();
    await testEnv.DB.prepare(
      "INSERT INTO voter_claim (poll_id, check_kind, digest, vote_id, created_at_ms) VALUES (?1, 'session', 'digest-selection', ?2, 0)",
    )
      .bind(pollId, voteId)
      .run();

    await expect(
      testEnv.DB.prepare(
        "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
      )
        .bind(voteId, optionId)
        .run(),
    ).rejects.toThrow(/UNIQUE|PRIMARY/i);

    await testEnv.DB.prepare("DELETE FROM vote WHERE id = ?1")
      .bind(voteId)
      .run();
    const selections = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM vote_selection WHERE vote_id = ?1",
    )
      .bind(voteId)
      .first<{ n: number }>();
    const claims = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM voter_claim WHERE vote_id = ?1",
    )
      .bind(voteId)
      .first<{ n: number }>();
    expect(selections?.n).toBe(0);
    expect(claims?.n).toBe(0);
  });

  it.each([
    ["explicitly closed", { closedAtMs: Date.now() - 1 }],
    ["past its deadline", { deadlineMs: Date.now() - 1 }],
  ])("rejects a vote when the poll is %s", async (suffix, state) => {
    const { pollId } = await insertPoll(`closed-${suffix}`, state);

    await expect(insertVote(pollId, `closed-${suffix}`)).rejects.toThrow(
      /poll_closed/i,
    );
  });

  it("accepts a vote while the poll deadline remains in the future", async () => {
    const { pollId } = await insertPoll("future", {
      deadlineMs: Date.now() + 60_000,
    });

    await expect(insertVote(pollId, "future")).resolves.toBe("vote-future");
  });

  it("fires the closed-poll trigger before the submission unique check", async () => {
    const { pollId } = await insertPoll("trigger-order");
    await insertVote(pollId, "trigger-order", "shared-submission");
    await testEnv.DB.prepare("UPDATE poll SET closed_at_ms = ?1 WHERE id = ?2")
      .bind(Date.now(), pollId)
      .run();

    // A late replay with the same submission_id hits the trigger, not the
    // unique constraint — the application re-reads to adjudicate.
    await expect(
      insertVote(pollId, "trigger-order-replay", "shared-submission"),
    ).rejects.toThrow(/poll_closed/i);
  });
});
