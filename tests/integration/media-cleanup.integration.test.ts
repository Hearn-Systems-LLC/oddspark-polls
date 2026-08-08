import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createMediaPersistence,
  createPollPersistence,
} from "../../src/adapters/d1/index";
import { replaceOptionImage } from "../../src/modules/media/index";
import {
  deletePoll,
  type PollPersistenceRows,
} from "../../src/modules/polls/index";
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
const POLL_ID = "poll-cleanup" as PollId;
const OWNER_ID = "owner-cleanup" as UserId;
const OTHER_ID = "owner-other" as UserId;

function pollRows(pollType: "image" | "multiple_choice"): PollPersistenceRows {
  const media = pollType === "image"
    ? [
        {
          id: "media-a",
          pollId: POLL_ID,
          optionId: "option-a" as PollOptionId,
          r2Key: "tmp/poll-cleanup/media-a",
          contentType: "image/jpeg",
          sizeBytes: 100,
          altText: "Photo A",
          caption: null,
          createdAtMs: NOW,
        },
        {
          id: "media-b",
          pollId: POLL_ID,
          optionId: "option-b" as PollOptionId,
          r2Key: "tmp/poll-cleanup/media-b",
          contentType: "image/png",
          sizeBytes: 200,
          altText: "Photo B",
          caption: "Caption B",
          createdAtMs: NOW,
        },
      ]
    : undefined;

  return {
    poll: {
      id: POLL_ID,
      ownerUserId: OWNER_ID,
      pollType,
      question: "Choose an image",
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
      { id: "option-a" as PollOptionId, pollId: POLL_ID, label: "A", position: 0, createdAtMs: NOW },
      { id: "option-b" as PollOptionId, pollId: POLL_ID, label: "B", position: 1, createdAtMs: NOW },
    ],
    reference: {
      reference: "cleanup-ref",
      pollId: POLL_ID,
      kind: "generated",
      createdAtMs: NOW,
    },
    media,
  };
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM cleanup_outbox").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM media_object").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Creator', ?2, 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).bind(OWNER_ID, "owner-cleanup@example.test").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Other', ?2, 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).bind(OTHER_ID, "owner-other@example.test").run();
});

describe("Media cleanup D1 persistence", () => {
  it("enqueues exact image keys and hard-deletes the Poll children atomically", async () => {
    const polls = createPollPersistence(testEnv.DB);
    await polls.insertPoll(pollRows("image"));

    const result = await deletePoll(
      {
        loadOwnedPoll: (id, owner) => polls.loadLifecycleForOwner(id, owner),
        deletePoll: (input) => polls.deletePollForOwner(input),
        nowMs: () => NOW + 50,
      },
      POLL_ID,
      OWNER_ID,
    );

    expect(result).toEqual({ ok: true, value: { kind: "deleted" } });
    const cleanup = await testEnv.DB.prepare(
      "SELECT r2_key, enqueued_at_ms, attempts FROM cleanup_outbox ORDER BY r2_key",
    ).all<{ r2_key: string; enqueued_at_ms: number; attempts: number }>();
    expect(cleanup.results).toEqual([
      { r2_key: "tmp/poll-cleanup/media-a", enqueued_at_ms: NOW + 50, attempts: 0 },
      { r2_key: "tmp/poll-cleanup/media-b", enqueued_at_ms: NOW + 50, attempts: 0 },
    ]);
    expect(await testEnv.DB.prepare("SELECT id FROM poll WHERE id = ?1").bind(POLL_ID).first()).toBeNull();
    expect((await testEnv.DB.prepare("SELECT id FROM media_object WHERE poll_id = ?1").bind(POLL_ID).all()).results).toEqual([]);
  });

  it("does not enqueue cleanup for non-image or non-owner deletion", async () => {
    const polls = createPollPersistence(testEnv.DB);
    await polls.insertPoll(pollRows("multiple_choice"));

    expect(await polls.deletePollForOwner({
      pollId: POLL_ID,
      ownerUserId: OTHER_ID,
      enqueuedAtMs: NOW,
    })).toBe("not_found");
    expect((await testEnv.DB.prepare("SELECT id FROM cleanup_outbox").all()).results).toEqual([]);

    expect(await polls.deletePollForOwner({
      pollId: POLL_ID,
      ownerUserId: OWNER_ID,
      enqueuedAtMs: NOW,
    })).toBe("deleted");
    expect((await testEnv.DB.prepare("SELECT id FROM cleanup_outbox").all()).results).toEqual([]);
  });

  it("replaces an option image and enqueues the superseded key in one batch", async () => {
    const polls = createPollPersistence(testEnv.DB);
    await polls.insertPoll(pollRows("image"));
    const media = createMediaPersistence(testEnv.DB);

    const result = await replaceOptionImage(
      { replaceOptionImage: (input) => media.replaceOptionImage(input), nowMs: () => NOW + 75 },
      {
        pollId: POLL_ID,
        ownerUserId: OWNER_ID,
        optionId: "option-a" as PollOptionId,
        r2Key: "tmp/poll-cleanup/media-new",
        contentType: "image/webp",
        sizeBytes: 300,
        altText: "Replacement",
        caption: "New caption",
      },
    );

    expect(result).toEqual({ ok: true, value: { kind: "replaced" } });
    expect(await testEnv.DB.prepare(
      "SELECT r2_key, content_type, size_bytes, alt_text, caption FROM media_object WHERE option_id = ?1",
    ).bind("option-a").first()).toEqual({
      r2_key: "tmp/poll-cleanup/media-new",
      content_type: "image/webp",
      size_bytes: 300,
      alt_text: "Replacement",
      caption: "New caption",
    });
    expect(await testEnv.DB.prepare(
      "SELECT r2_key, enqueued_at_ms FROM cleanup_outbox",
    ).first()).toEqual({
      r2_key: "tmp/poll-cleanup/media-a",
      enqueued_at_ms: NOW + 75,
    });
  });

  it("blocks image replacement after the first Vote", async () => {
    const polls = createPollPersistence(testEnv.DB);
    await polls.insertPoll(pollRows("image"));
    await testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('vote-1', ?1, 'submission-1', 'hash-1', ?2)",
    ).bind(POLL_ID, NOW).run();
    const media = createMediaPersistence(testEnv.DB);

    const result = await replaceOptionImage(
      { replaceOptionImage: (input) => media.replaceOptionImage(input), nowMs: () => NOW + 75 },
      {
        pollId: POLL_ID,
        ownerUserId: OWNER_ID,
        optionId: "option-a" as PollOptionId,
        r2Key: "tmp/poll-cleanup/media-new",
        contentType: "image/webp",
        sizeBytes: 300,
        altText: "Replacement",
        caption: null,
      },
    );

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "image_replacement_locked" }),
    });
    expect((await testEnv.DB.prepare("SELECT id FROM cleanup_outbox").all()).results).toEqual([]);
    expect((await testEnv.DB.prepare("SELECT r2_key FROM media_object WHERE option_id = 'option-a'").first<{ r2_key: string }>())?.r2_key).toBe("tmp/poll-cleanup/media-a");
  });
});
