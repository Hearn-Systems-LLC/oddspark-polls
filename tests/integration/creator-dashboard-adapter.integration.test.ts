import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createPollPersistence } from "../../src/adapters/d1/index";
import type { PollPersistenceRows } from "../../src/modules/polls/index";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";
import { effectivePollStatus } from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_784_000_000_000;
const OWNER_A = "owner-a" as UserId;
const OWNER_B = "owner-b" as UserId;
const POLL_A1 = "poll-a1" as PollId;
const POLL_A2 = "poll-a2" as PollId;
const POLL_A3 = "poll-a3" as PollId;
const POLL_A4 = "poll-a4" as PollId;
const POLL_B1 = "poll-b1" as PollId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
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
    createdAtMs?: number;
    deadlineMs?: number | null;
    multiSelectEnabled?: boolean;
    reference?: string;
  } = {},
): PollPersistenceRows {
  const createdAtMs = overrides.createdAtMs ?? NOW;
  return {
    poll: {
      id: pollId,
      ownerUserId,
      pollType: "multiple_choice",
      question: overrides.question ?? `Question ${pollId}`,
      description: null,
      resultVisibility: "live",
      discoveryState: "unlisted",
      sessionChecksEnabled: true,
      ipChecksEnabled: false,
      voterCodesEnabled: false,
      captchaEnabled: false,
      vpnBlockingEnabled: false,
      commentsEnabled: false,
      multiSelectEnabled: overrides.multiSelectEnabled ?? false,
      minSelections: null,
      maxSelections: null,
      deadlineMs: overrides.deadlineMs ?? null,
      representationVersion: 1,
      createdAtMs,
    },
    options: [
      {
        id: `${pollId}-opt-1` as PollOptionId,
        pollId,
        label: "A",
        position: 0,
        createdAtMs,
      },
      {
        id: `${pollId}-opt-2` as PollOptionId,
        pollId,
        label: "B",
        position: 1,
        createdAtMs,
      },
    ],
    reference: {
      reference: overrides.reference ?? `ref-${pollId}`,
      pollId,
      kind: "generated",
      createdAtMs,
    },
  };
}

async function insertVote(
  pollId: PollId,
  voteId: string,
  optionIds: string[],
): Promise<void> {
  await testEnv.DB.prepare(
    "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
  )
    .bind(voteId, pollId, `sub-${voteId}`, `hash-${voteId}`, NOW)
    .run();
  for (const optionId of optionIds) {
    await testEnv.DB.prepare(
      "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
    )
      .bind(voteId, optionId)
      .run();
  }
}

describe("listPollsForOwner (Story 1.11)", () => {
  it("returns only the owner's polls and isolates their vote counts", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      pollRows(POLL_A1, OWNER_A, { question: "A's poll" }),
    );
    await persistence.insertPoll(
      pollRows(POLL_B1, OWNER_B, { question: "B's poll" }),
    );
    await insertVote(POLL_A1, "vote-a-1", [`${POLL_A1}-opt-1`]);
    await insertVote(POLL_B1, "vote-b-1", [`${POLL_B1}-opt-1`]);
    await insertVote(POLL_B1, "vote-b-2", [`${POLL_B1}-opt-2`]);

    const forA = await persistence.listPollsForOwner(OWNER_A, NOW);
    expect(forA).toHaveLength(1);
    expect(forA[0]?.pollId).toBe(POLL_A1);
    expect(forA[0]?.question).toBe("A's poll");
    expect(forA[0]?.voterCount).toBe(1);

    const forB = await persistence.listPollsForOwner(OWNER_B, NOW);
    expect(forB).toHaveLength(1);
    expect(forB[0]?.pollId).toBe(POLL_B1);
    expect(forB[0]?.voterCount).toBe(2);
  });

  it("drives from the owner index and probes vote counts by poll index", async () => {
    let listSql = "";
    const instrumentedDb = {
      prepare(query: string) {
        listSql = query;
        return testEnv.DB.prepare(query);
      },
    } as D1Database;

    const persistence = createPollPersistence(instrumentedDb);
    await persistence.listPollsForOwner(OWNER_A, NOW);

    const plan = await testEnv.DB.prepare(`EXPLAIN QUERY PLAN ${listSql}`)
      .bind(OWNER_A, NOW)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail);

    expect(
      details.some((detail) =>
        detail.includes("SEARCH p USING INDEX poll_owner_user_id_idx"),
      ),
    ).toBe(true);
    expect(
      details.some((detail) =>
        detail.includes("SEARCH v USING COVERING INDEX vote_poll_id_idx"),
      ),
    ).toBe(true);
    expect(details.some((detail) => detail.includes("MATERIALIZE"))).toBe(
      false,
    );
  });

  it("counts voters not selections on multi-select polls", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      pollRows(POLL_A1, OWNER_A, { multiSelectEnabled: true }),
    );

    // Zero votes
    let list = await persistence.listPollsForOwner(OWNER_A, NOW);
    expect(list[0]?.voterCount).toBe(0);

    // One voter, two selections
    await insertVote(POLL_A1, "vote-1", [
      `${POLL_A1}-opt-1`,
      `${POLL_A1}-opt-2`,
    ]);
    list = await persistence.listPollsForOwner(OWNER_A, NOW);
    expect(list[0]?.voterCount).toBe(1);

    // Second voter, one selection
    await insertVote(POLL_A1, "vote-2", [`${POLL_A1}-opt-1`]);
    list = await persistence.listPollsForOwner(OWNER_A, NOW);
    expect(list[0]?.voterCount).toBe(2);
  });

  it("orders live above closed, newest first within each group", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    // Older live
    await persistence.insertPoll(
      pollRows(POLL_A1, OWNER_A, {
        question: "Older live",
        createdAtMs: NOW - 3_000,
      }),
    );
    // Newer live
    await persistence.insertPoll(
      pollRows(POLL_A2, OWNER_A, {
        question: "Newer live",
        createdAtMs: NOW - 1_000,
      }),
    );
    // Closed via closed_at_ms, newer than some live
    await persistence.insertPoll(
      pollRows(POLL_A3, OWNER_A, {
        question: "Closed explicit",
        createdAtMs: NOW - 500,
      }),
    );
    await testEnv.DB.prepare(
      "UPDATE poll SET closed_at_ms = ?1 WHERE id = ?2",
    )
      .bind(NOW - 100, POLL_A3)
      .run();

    const list = await persistence.listPollsForOwner(OWNER_A, NOW);
    expect(list.map((row) => row.pollId)).toEqual([
      POLL_A2,
      POLL_A1,
      POLL_A3,
    ]);
    for (const row of list) {
      expect(effectivePollStatus(row, NOW)).toBe(
        row.pollId === POLL_A3 ? "closed" : "open",
      );
    }
  });

  it("treats deadline-passed unmaterialized polls as closed for sort and status", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      pollRows(POLL_A1, OWNER_A, {
        question: "Still open",
        createdAtMs: NOW - 2_000,
        deadlineMs: NOW + 60_000,
      }),
    );
    // closed_at_ms NULL, deadline in the past — AD-11 closed at request time
    await persistence.insertPoll(
      pollRows(POLL_A4, OWNER_A, {
        question: "Deadline passed",
        createdAtMs: NOW - 1_000,
        deadlineMs: NOW - 1,
      }),
    );

    const list = await persistence.listPollsForOwner(OWNER_A, NOW);
    expect(list.map((row) => row.pollId)).toEqual([POLL_A1, POLL_A4]);
    expect(effectivePollStatus(list[0]!, NOW)).toBe("open");
    expect(effectivePollStatus(list[1]!, NOW)).toBe("closed");
    expect(list[1]!.closedAtMs).toBeNull();
    expect(list[1]!.deadlineMs).toBe(NOW - 1);
  });
});
