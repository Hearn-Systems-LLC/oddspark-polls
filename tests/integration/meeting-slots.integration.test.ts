import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createPollPersistence } from "../../src/adapters/d1/index";
import type { PollPersistenceRows } from "../../src/modules/polls/index";
import type { PollId, UserId } from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_800_000_000_000;

async function insertPoll(id: string, pollType: string): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO poll
      (id, owner_user_id, poll_type, question, result_visibility,
       multi_select_enabled, min_selections, max_selections,
       representation_version, created_at_ms, updated_at_ms)
     VALUES (?1, 'meeting-owner', ?2, 'When works?', 'live', 0, NULL, NULL, 1, ?3, ?3)`,
  )
    .bind(id, pollType, NOW)
    .run();
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM meeting_slot").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('meeting-owner', 'Creator', 'meeting-owner@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).run();
});

describe("meeting_slot schema constraints (0016)", () => {
  it("inserts the Poll, slots, and reference atomically through the adapter", async () => {
    const pollId = "meeting-adapter" as PollId;
    const rows: PollPersistenceRows = {
      poll: {
        id: pollId,
        ownerUserId: "meeting-owner" as UserId,
        pollType: "meeting",
        question: "When works?",
        description: null,
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
      options: [],
      slots: [
        {
          id: "adapter-slot-1",
          pollId,
          startsAtMs: NOW,
          endsAtMs: NOW + 30 * 60_000,
          timeZone: "America/Detroit",
          position: 0,
          createdAtMs: NOW,
        },
        {
          id: "adapter-slot-2",
          pollId,
          startsAtMs: NOW + 86_400_000,
          endsAtMs: NOW + 86_400_000 + 60 * 60_000,
          timeZone: "America/Detroit",
          position: 1,
          createdAtMs: NOW,
        },
      ],
      reference: {
        reference: "meeting-adapter-ref",
        pollId,
        kind: "generated",
        createdAtMs: NOW,
      },
    };

    await createPollPersistence(testEnv.DB).insertPoll(rows);
    const page = await createPollPersistence(testEnv.DB).findPollForOwner(
      pollId,
      "meeting-owner" as UserId,
    );
    expect(page?.options).toEqual([]);
    expect(page?.slots).toEqual([
      {
        id: "adapter-slot-1",
        startsAtMs: NOW,
        endsAtMs: NOW + 30 * 60_000,
        timeZone: "America/Detroit",
        position: 0,
      },
      {
        id: "adapter-slot-2",
        startsAtMs: NOW + 86_400_000,
        endsAtMs: NOW + 86_400_000 + 60 * 60_000,
        timeZone: "America/Detroit",
        position: 1,
      },
    ]);
  });

  it("stores heterogeneous absolute slot facts in stable position order", async () => {
    await insertPoll("meeting-1", "meeting");
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "INSERT INTO meeting_slot (id, poll_id, position, starts_at_ms, ends_at_ms, time_zone, created_at_ms) VALUES ('slot-1', 'meeting-1', 0, ?1, ?2, 'America/Detroit', ?3)",
      ).bind(NOW, NOW + 30 * 60_000, NOW),
      testEnv.DB.prepare(
        "INSERT INTO meeting_slot (id, poll_id, position, starts_at_ms, ends_at_ms, time_zone, created_at_ms) VALUES ('slot-2', 'meeting-1', 1, ?1, ?2, 'America/Detroit', ?3)",
      ).bind(NOW + 86_400_000, NOW + 86_400_000 + 90 * 60_000, NOW),
    ]);

    const rows = await testEnv.DB.prepare(
      "SELECT position, starts_at_ms, ends_at_ms, time_zone FROM meeting_slot WHERE poll_id = 'meeting-1' ORDER BY position",
    ).all();
    expect(rows.results).toEqual([
      {
        position: 0,
        starts_at_ms: NOW,
        ends_at_ms: NOW + 30 * 60_000,
        time_zone: "America/Detroit",
      },
      {
        position: 1,
        starts_at_ms: NOW + 86_400_000,
        ends_at_ms: NOW + 86_400_000 + 90 * 60_000,
        time_zone: "America/Detroit",
      },
    ]);
  });

  it("rejects non-positive durations and duplicate positions", async () => {
    await insertPoll("meeting-1", "meeting");
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO meeting_slot (id, poll_id, position, starts_at_ms, ends_at_ms, time_zone, created_at_ms) VALUES ('slot-invalid', 'meeting-1', 0, ?1, ?1, 'UTC', ?1)",
      )
        .bind(NOW)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);

    await testEnv.DB.prepare(
      "INSERT INTO meeting_slot (id, poll_id, position, starts_at_ms, ends_at_ms, time_zone, created_at_ms) VALUES ('slot-1', 'meeting-1', 0, ?1, ?2, 'UTC', ?1)",
    )
      .bind(NOW, NOW + 1)
      .run();
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO meeting_slot (id, poll_id, position, starts_at_ms, ends_at_ms, time_zone, created_at_ms) VALUES ('slot-2', 'meeting-1', 0, ?1, ?2, 'UTC', ?1)",
      )
        .bind(NOW + 2, NOW + 3)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("enforces Meeting Poll bounds on inserts and updates", async () => {
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO poll
          (id, owner_user_id, poll_type, question, result_visibility,
           multi_select_enabled, min_selections, max_selections,
           representation_version, created_at_ms, updated_at_ms)
         VALUES ('bad-meeting', 'meeting-owner', 'meeting', 'When?', 'live', 1, 1, 2, 1, ?1, ?1)`,
      )
        .bind(NOW)
        .run(),
    ).rejects.toThrow(/meeting_poll_bounds_invalid/);

    await insertPoll("meeting-1", "meeting");
    await expect(
      testEnv.DB.prepare(
        "UPDATE poll SET min_selections = 1 WHERE id = 'meeting-1'",
      ).run(),
    ).rejects.toThrow(/meeting_poll_bounds_invalid/);
  });

  it("rejects slots for every non-Meeting Poll", async () => {
    await insertPoll("ordinary-1", "multiple_choice");
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO meeting_slot (id, poll_id, position, starts_at_ms, ends_at_ms, time_zone, created_at_ms) VALUES ('slot-wrong-type', 'ordinary-1', 0, ?1, ?2, 'UTC', ?1)",
      )
        .bind(NOW, NOW + 1)
        .run(),
    ).rejects.toThrow(/meeting_slot_poll_type_invalid/);
  });

  it("cascades slots when their Meeting Poll is deleted", async () => {
    await insertPoll("meeting-1", "meeting");
    await testEnv.DB.prepare(
      "INSERT INTO meeting_slot (id, poll_id, position, starts_at_ms, ends_at_ms, time_zone, created_at_ms) VALUES ('slot-1', 'meeting-1', 0, ?1, ?2, 'UTC', ?1)",
    )
      .bind(NOW, NOW + 1)
      .run();

    await testEnv.DB.prepare("DELETE FROM poll WHERE id = 'meeting-1'").run();
    const row = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM meeting_slot WHERE poll_id = 'meeting-1'",
    ).first<{ count: number }>();
    expect(row?.count).toBe(0);
  });
});
