import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createMediaPersistence,
  createPollPersistence,
} from "../../src/adapters/d1/index";
import { createR2MediaStorage } from "../../src/adapters/r2/index";
import {
  drainCleanupOutbox,
  replaceOptionImage,
  sweepTempKeys,
} from "../../src/modules/media/index";
import {
  deletePoll,
  type PollPersistenceRows,
} from "../../src/modules/polls/index";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";
import PublicPoll from "../../src/pages/[reference].astro";

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
    await Promise.all([
      testEnv.MEDIA.put("tmp/poll-cleanup/media-a", "a"),
      testEnv.MEDIA.put("tmp/poll-cleanup/media-b", "b"),
    ]);

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
    const outboxRows = await testEnv.DB.prepare(
      "SELECT r2_key, enqueued_at_ms, attempts FROM cleanup_outbox ORDER BY r2_key",
    ).all<{ r2_key: string; enqueued_at_ms: number; attempts: number }>();
    expect(outboxRows.results).toEqual([
      { r2_key: "tmp/poll-cleanup/media-a", enqueued_at_ms: NOW + 50, attempts: 0 },
      { r2_key: "tmp/poll-cleanup/media-b", enqueued_at_ms: NOW + 50, attempts: 0 },
    ]);
    expect(await testEnv.DB.prepare("SELECT id FROM poll WHERE id = ?1").bind(POLL_ID).first()).toBeNull();
    expect((await testEnv.DB.prepare("SELECT id FROM media_object WHERE poll_id = ?1").bind(POLL_ID).all()).results).toEqual([]);

    const container = await AstroContainer.create();
    const response = await container.renderToResponse(PublicPoll, {
      request: new Request("https://polls.example.test/cleanup-ref"),
      params: { reference: "cleanup-ref" },
      locals: {} as unknown as App.Locals,
    });
    expect(response.status).toBe(404);
    expect(await testEnv.MEDIA.head("tmp/poll-cleanup/media-a")).not.toBeNull();
    expect(await testEnv.MEDIA.head("tmp/poll-cleanup/media-b")).not.toBeNull();

    const cleanupPersistence = createMediaPersistence(testEnv.DB);
    const storage = createR2MediaStorage(testEnv.MEDIA);
    expect(await drainCleanupOutbox({ outbox: cleanupPersistence, objects: storage })).toEqual({
      selected: 2,
      deleted: 2,
      failed: 0,
    });
    expect(await testEnv.MEDIA.head("tmp/poll-cleanup/media-a")).toBeNull();
    expect(await testEnv.MEDIA.head("tmp/poll-cleanup/media-b")).toBeNull();
    expect(await drainCleanupOutbox({ outbox: cleanupPersistence, objects: storage })).toEqual({
      selected: 0,
      deleted: 0,
      failed: 0,
    });
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

  it("selects fresh rows ahead of repeatedly failing older rows", async () => {
    // 100 poison rows (old, many attempts) must not starve a newer row that
    // has never been tried.
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < 100; index += 1) {
      statements.push(
        testEnv.DB.prepare(
          "INSERT INTO cleanup_outbox (id, r2_key, enqueued_at_ms, attempts) VALUES (?1, ?2, ?3, ?4)",
        ).bind(`poison-${index}`, `tmp/poison/${index}`, 1 + index, 5),
      );
    }
    statements.push(
      testEnv.DB.prepare(
        "INSERT INTO cleanup_outbox (id, r2_key, enqueued_at_ms, attempts) VALUES ('fresh-row', 'tmp/fresh/row', 999_999, 0)",
      ),
    );
    await testEnv.DB.batch(statements);

    const media = createMediaPersistence(testEnv.DB);
    const due = await media.listDue(100);

    expect(due).toHaveLength(100);
    expect(due[0]?.id).toBe("fresh-row");
    expect(due.filter((row) => row.attempts === 5)).toHaveLength(99);
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

describe("Media cleanup R2 adapter", () => {
  it("lists only tmp keys with upload timestamps and pagination metadata", async () => {
    await testEnv.MEDIA.put("tmp/adapter/a", "a");
    await testEnv.MEDIA.put("adopted/adapter/b", "b");
    const storage = createR2MediaStorage(testEnv.MEDIA);

    const page = await storage.listTempKeys(undefined, 100);

    expect(page.objects).toHaveLength(1);
    expect(page.objects[0]?.key).toBe("tmp/adapter/a");
    expect(page.objects[0]?.uploadedAtMs).toEqual(expect.any(Number));
    expect(page.truncated).toBe(false);
  });

  it("treats deleting a missing key as an idempotent success", async () => {
    const storage = createR2MediaStorage(testEnv.MEDIA);

    await expect(storage.deleteObject("tmp/adapter/missing")).resolves.toBeUndefined();
  });

  it("keeps old adopted tmp keys, deletes old orphans, and keeps young orphans", async () => {
    const polls = createPollPersistence(testEnv.DB);
    await polls.insertPoll(pollRows("image"));
    const oldAdopted = "tmp/poll-cleanup/media-a";
    const oldOrphan = "tmp/sweep/old-orphan";
    const youngOrphan = "tmp/sweep/young-orphan";
    await Promise.all([
      testEnv.MEDIA.put(oldAdopted, "adopted"),
      testEnv.MEDIA.put(oldOrphan, "old"),
      testEnv.MEDIA.put(youngOrphan, "young"),
    ]);
    const persistence = createMediaPersistence(testEnv.DB);
    const storage = createR2MediaStorage(testEnv.MEDIA);

    const result = await sweepTempKeys({
      objects: {
        listTempKeys: async () => ({
          objects: [
            { key: oldAdopted, uploadedAtMs: NOW - 86_400_001 },
            { key: oldOrphan, uploadedAtMs: NOW - 86_400_001 },
            { key: youngOrphan, uploadedAtMs: NOW - 86_399_999 },
          ],
          truncated: false,
        }),
        deleteObject: storage.deleteObject,
      },
      ownership: persistence,
      nowMs: () => NOW,
    });

    expect(result).toEqual({ listed: 3, eligible: 2, adopted: 1, deleted: 1 });
    expect(await testEnv.MEDIA.head(oldAdopted)).not.toBeNull();
    expect(await testEnv.MEDIA.head(oldOrphan)).toBeNull();
    expect(await testEnv.MEDIA.head(youngOrphan)).not.toBeNull();
  });

  it("deletes nothing when the D1 adoption check fails", async () => {
    const key = "tmp/sweep/fail-closed";
    await testEnv.MEDIA.put(key, "keep");
    const storage = createR2MediaStorage(testEnv.MEDIA);

    await expect(sweepTempKeys({
      objects: {
        listTempKeys: async () => ({
          objects: [{ key, uploadedAtMs: 0 }],
          truncated: false,
        }),
        deleteObject: storage.deleteObject,
      },
      ownership: {
        findAdoptedKeys: async () => {
          throw new Error("D1 unavailable");
        },
      },
      nowMs: () => NOW,
    })).rejects.toThrow("D1 unavailable");
    expect(await testEnv.MEDIA.head(key)).not.toBeNull();
  });
});
