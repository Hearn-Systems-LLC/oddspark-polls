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

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_784_000_000_000;
const POLL_1 = "poll-img-1" as PollId;
const OWNER_1 = "owner-1" as UserId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM media_object").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('owner-1', 'Creator', 'owner-1@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).run();
});

function imagePollRows(overrides: Partial<PollPersistenceRows> = {}): PollPersistenceRows {
  return {
    poll: {
      id: POLL_1,
      ownerUserId: OWNER_1,
      pollType: "image",
      question: "Which photo?",
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
    options: [
      { id: "opt-1" as PollOptionId, pollId: POLL_1, label: "Photo A", position: 0, createdAtMs: NOW },
      { id: "opt-2" as PollOptionId, pollId: POLL_1, label: "Photo B", position: 1, createdAtMs: NOW },
    ],
    reference: {
      reference: "img-ref-abc",
      pollId: POLL_1,
      kind: "generated",
      createdAtMs: NOW,
    },
    media: [
      {
        id: "media-1",
        pollId: POLL_1,
        optionId: "opt-1" as PollOptionId,
        r2Key: "tmp/poll-img-1/media-1",
        contentType: "image/jpeg",
        sizeBytes: 1024,
        altText: "A sunset over the ocean",
        caption: "Sunset",
        createdAtMs: NOW,
      },
      {
        id: "media-2",
        pollId: POLL_1,
        optionId: "opt-2" as PollOptionId,
        r2Key: "tmp/poll-img-1/media-2",
        contentType: "image/png",
        sizeBytes: 2048,
        altText: "A mountain landscape",
        caption: null,
        createdAtMs: NOW,
      },
    ],
    ...overrides,
  };
}

describe("media_object schema constraints (0014)", () => {
  it("inserts media rows in the same batch as poll creation", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(imagePollRows());

    const mediaRows = await testEnv.DB.prepare(
      "SELECT id, poll_id, option_id, r2_key, content_type, size_bytes, alt_text, caption FROM media_object WHERE poll_id = ?1 ORDER BY id",
    )
      .bind(POLL_1)
      .all<{ id: string; poll_id: string; option_id: string; r2_key: string; content_type: string; size_bytes: number; alt_text: string; caption: string | null }>();

    expect(mediaRows.results).toHaveLength(2);
    expect(mediaRows.results[0]).toMatchObject({
      id: "media-1",
      poll_id: POLL_1,
      option_id: "opt-1",
      r2_key: "tmp/poll-img-1/media-1",
      content_type: "image/jpeg",
      size_bytes: 1024,
      alt_text: "A sunset over the ocean",
      caption: "Sunset",
    });
    expect(mediaRows.results[1]).toMatchObject({
      id: "media-2",
      caption: null,
    });
  });

  it("enforces UNIQUE constraint on option_id", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(imagePollRows());

    // Try inserting a second media row for the same option_id.
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO media_object (id, poll_id, option_id, r2_key, content_type, size_bytes, alt_text, caption, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      )
        .bind("media-dup", POLL_1, "opt-1", "tmp/poll-img-1/media-dup", "image/jpeg", 512, "Duplicate", null, NOW)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("enforces UNIQUE constraint on r2_key", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    // Create a poll with 3 options so we have an unused option for the dup test.
    const threeOptionRows = imagePollRows({
      options: [
        { id: "opt-1" as PollOptionId, pollId: POLL_1, label: "Photo A", position: 0, createdAtMs: NOW },
        { id: "opt-2" as PollOptionId, pollId: POLL_1, label: "Photo B", position: 1, createdAtMs: NOW },
        { id: "opt-3" as PollOptionId, pollId: POLL_1, label: "Photo C", position: 2, createdAtMs: NOW },
      ],
    });
    await persistence.insertPoll(threeOptionRows);

    // Use opt-3 (no media yet) but reuse media-1's r2_key.
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO media_object (id, poll_id, option_id, r2_key, content_type, size_bytes, alt_text, caption, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      )
        .bind("media-dup-key", POLL_1, "opt-3", "tmp/poll-img-1/media-1", "image/jpeg", 512, "Dup key", null, NOW)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it("enforces NOT NULL + non-empty alt_text", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    // First create the poll without media so we have the parent rows.
    const baseRows = imagePollRows({ media: undefined });
    await persistence.insertPoll(baseRows);

    // Empty alt_text should fail the CHECK constraint.
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO media_object (id, poll_id, option_id, r2_key, content_type, size_bytes, alt_text, caption, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
      )
        .bind("media-no-alt", POLL_1, "opt-1", "tmp/poll-img-1/media-no-alt", "image/jpeg", 512, "", null, NOW)
        .run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });

  it("cascades deletion when the parent poll is deleted", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(imagePollRows());

    await testEnv.DB.prepare("DELETE FROM poll WHERE id = ?1").bind(POLL_1).run();

    const remaining = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM media_object WHERE poll_id = ?1",
    )
      .bind(POLL_1)
      .first<{ cnt: number }>();
    expect(remaining?.cnt).toBe(0);
  });

  it("cascades deletion when the parent poll_option is deleted", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(imagePollRows());

    await testEnv.DB.prepare("DELETE FROM poll_option WHERE id = ?1").bind("opt-1").run();

    const remaining = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM media_object WHERE option_id = ?1",
    )
      .bind("opt-1")
      .first<{ cnt: number }>();
    expect(remaining?.cnt).toBe(0);
  });
});

describe("insertPoll batch atomicity with media", () => {
  it("does not add media rows when the batch fails on duplicate poll id", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(imagePollRows());

    // Replay the same batch — should fail on poll.id UNIQUE.
    await expect(persistence.insertPoll(imagePollRows())).rejects.toThrow();

    // The original media rows should still exist (from the first successful insert),
    // but no NEW media rows should have been added by the failed replay.
    const count = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM media_object WHERE poll_id = ?1",
    )
      .bind(POLL_1)
      .first<{ cnt: number }>();
    expect(count?.cnt).toBe(2);
  });
});

describe("findPollByReference returns media for image polls (Story 6.2)", () => {
  it("includes media on each option when present", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(imagePollRows());

    const page = await persistence.findPollByReference("img-ref-abc");
    expect(page).not.toBeNull();
    expect(page!.pollType).toBe("image");
    expect(page!.options).toHaveLength(2);
    expect(page!.options[0].media).toEqual({
      mediaId: "media-1",
      altText: "A sunset over the ocean",
      caption: "Sunset",
    });
    expect(page!.options[1].media).toEqual({
      mediaId: "media-2",
      altText: "A mountain landscape",
      caption: null,
    });
  });

  it("omits media field for non-image polls", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    const mcRows: PollPersistenceRows = {
      poll: {
        id: "poll-mc-1" as PollId,
        ownerUserId: OWNER_1,
        pollType: "multiple_choice",
        question: "MC poll?",
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
      options: [
        { id: "opt-mc-1" as PollOptionId, pollId: "poll-mc-1" as PollId, label: "A", position: 0, createdAtMs: NOW },
        { id: "opt-mc-2" as PollOptionId, pollId: "poll-mc-1" as PollId, label: "B", position: 1, createdAtMs: NOW },
      ],
      reference: {
        reference: "mc-ref-1",
        pollId: "poll-mc-1" as PollId,
        kind: "generated",
        createdAtMs: NOW,
      },
    };
    await persistence.insertPoll(mcRows);

    const page = await persistence.findPollByReference("mc-ref-1");
    expect(page).not.toBeNull();
    expect(page!.pollType).toBe("multiple_choice");
    expect(page!.options[0].media).toBeUndefined();
    expect(page!.options[1].media).toBeUndefined();
  });
});
