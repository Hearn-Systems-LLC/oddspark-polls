import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createCommentModerationPersistence,
  createResultsPersistence,
} from "../../src/adapters/d1/index";
import type {
  CommentId,
  PollId,
  UserId,
} from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as MigrationTestEnv;
const POLL_ID = "comment-moderation-poll" as PollId;
const OWNER = "comment-moderation-owner" as UserId;
const OTHER = "comment-moderation-other" as UserId;
const ADMIN = "comment-moderation-admin" as UserId;
const NEWEST_A = "comment-z" as CommentId;
const NEWEST_B = "comment-a" as CommentId;
const OLDEST = "comment-old" as CommentId;
const NOW = 1_800_000_000_000;

async function insertUser(id: UserId, role = "creator"): Promise<void> {
  await testEnv.DB.prepare(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at, role) VALUES (?1, 'Fixture', ?2, 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', ?3)",
  ).bind(id, `${id}@example.test`, role).run();
}

async function seed(): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, comments_enabled, representation_version, created_at_ms, updated_at_ms) VALUES (?1, ?2, 'multiple_choice', 'Comments?', 'live', 1, 7, 0, 0)",
    ).bind(POLL_ID, OWNER),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES ('comment-option', ?1, 'Yes', 0, 0)",
    ).bind(POLL_ID),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('comment-moderation-ref', ?1, 'custom', 1, 0)",
    ).bind(POLL_ID),
    ...[
      ["comment-vote-z", NEWEST_A, "Newest z", "<Admin>", NOW],
      ["comment-vote-a", NEWEST_B, "Newest a", null, NOW],
      ["comment-vote-old", OLDEST, "Older <script>alert(1)</script>", null, NOW - 1],
    ].flatMap(([voteId, commentId, body, displayName, createdAtMs]) => [
      testEnv.DB.prepare(
        "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
      ).bind(voteId, POLL_ID, `submission-${voteId}`, `hash-${voteId}`, createdAtMs),
      testEnv.DB.prepare(
        "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, 'comment-option')",
      ).bind(voteId),
      testEnv.DB.prepare(
        "INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
      ).bind(commentId, voteId, body, displayName, createdAtMs),
    ]),
  ]);
}

async function state(): Promise<{ version: number; comments: number; votes: number }> {
  const row = await testEnv.DB.prepare(
    "SELECT p.representation_version AS version, (SELECT COUNT(*) FROM vote_comment) AS comments, (SELECT COUNT(*) FROM vote) AS votes FROM poll p WHERE p.id = ?1",
  ).bind(POLL_ID).first<{ version: number; comments: number; votes: number }>();
  if (!row) throw new Error("missing fixture");
  return row;
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DROP TRIGGER IF EXISTS test_comment_delete_failure").run();
  await testEnv.DB.prepare("DELETE FROM vote_comment").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("DELETE FROM account").run();
  await testEnv.DB.prepare("DELETE FROM session").run();
  await testEnv.DB.prepare("DELETE FROM user").run();
  await insertUser(OWNER);
  await insertUser(OTHER);
  await insertUser(ADMIN, "administrator");
  await seed();
});

describe("Comment Results projection", () => {
  it("projects the complete newest-first list and only gives IDs to the owner projection", async () => {
    const persistence = createResultsPersistence(testEnv.DB);
    const publicProjection = await persistence.projectResults(POLL_ID, false);
    expect(publicProjection).not.toBeNull();
    if (!publicProjection) throw new Error("missing public projection");
    expect(publicProjection.comments.map(({ body }) => body)).toEqual([
      "Newest z",
      "Newest a",
      "Older <script>alert(1)</script>",
    ]);
    expect(publicProjection.ownerComments).toBeNull();
    expect(JSON.stringify(publicProjection)).not.toContain("comment-z");

    const ownerProjection = await persistence.projectResults(POLL_ID, true);
    expect(ownerProjection).not.toBeNull();
    if (!ownerProjection) throw new Error("missing owner projection");
    expect(ownerProjection.ownerComments?.map(({ commentId }) => commentId)).toEqual([
      NEWEST_A,
      NEWEST_B,
      OLDEST,
    ]);
    expect(ownerProjection.comments).toEqual(
      ownerProjection.ownerComments?.map(({ commentId: _commentId, ...comment }) => comment),
    );
  });

  it("fails closed on a malformed stored Comment", async () => {
    await testEnv.DB.prepare("UPDATE vote_comment SET body = ' untrimmed ' WHERE id = ?1")
      .bind(OLDEST)
      .run();
    const persistence = createResultsPersistence(testEnv.DB);
    await expect(persistence.projectResults(POLL_ID, false)).rejects.toThrow(
      "Malformed Comment projection",
    );
  });

  it("fails closed on unpostable IDs and timestamps outside the Date range", async () => {
    const persistence = createResultsPersistence(testEnv.DB);
    await testEnv.DB.prepare("UPDATE vote_comment SET id = 'bad.comment' WHERE id = ?1")
      .bind(NEWEST_A)
      .run();
    await expect(persistence.projectResults(POLL_ID, true)).rejects.toThrow(
      "Malformed owner Comment projection",
    );

    await testEnv.DB.prepare("UPDATE vote_comment SET id = ?1, created_at_ms = ?2 WHERE id = 'bad.comment'")
      .bind(NEWEST_A, 8_640_000_000_000_001)
      .run();
    await expect(persistence.projectResults(POLL_ID, false)).rejects.toThrow(
      "Malformed Comment projection",
    );
  });
});

describe("Comment moderation D1 transaction", () => {
  it("lets the owner delete only the Comment and increments the version once", async () => {
    const persistence = createCommentModerationPersistence(testEnv.DB);
    await expect(
      persistence.deleteForOwner({ actorUserId: OWNER, commentId: NEWEST_A, updatedAtMs: NOW + 1 }),
    ).resolves.toEqual({
      kind: "deleted",
      pollId: POLL_ID,
      canonicalReference: "comment-moderation-ref",
    });
    expect(await state()).toEqual({ version: 8, comments: 2, votes: 3 });
  });

  it("keeps denied, stale, and concurrent losers as no-op outcomes", async () => {
    const persistence = createCommentModerationPersistence(testEnv.DB);
    await expect(
      persistence.deleteForOwner({ actorUserId: OTHER, commentId: NEWEST_A, updatedAtMs: NOW + 1 }),
    ).resolves.toEqual({ kind: "not_found" });
    expect(await state()).toEqual({ version: 7, comments: 3, votes: 3 });

    const outcomes = await Promise.all([
      persistence.deleteForOwner({ actorUserId: OWNER, commentId: NEWEST_A, updatedAtMs: NOW + 2 }),
      persistence.deleteForOwner({ actorUserId: OWNER, commentId: NEWEST_A, updatedAtMs: NOW + 3 }),
    ]);
    expect(outcomes.map(({ kind }) => kind).sort()).toEqual(["deleted", "not_found"]);
    expect(await state()).toEqual({ version: 8, comments: 2, votes: 3 });
  });

  it("rechecks the live Administrator role for reads and deletes", async () => {
    const persistence = createCommentModerationPersistence(testEnv.DB);
    await expect(persistence.loadForAdministrator(ADMIN, POLL_ID)).resolves.toMatchObject({
      kind: "found",
      comments: [{ commentId: NEWEST_A }, { commentId: NEWEST_B }, { commentId: OLDEST }],
    });
    await testEnv.DB.prepare("UPDATE user SET role = 'creator' WHERE id = ?1").bind(ADMIN).run();
    await expect(persistence.loadForAdministrator(ADMIN, POLL_ID)).resolves.toEqual({ kind: "authorization_denied" });
    await expect(
      persistence.deleteForAdministrator({ actorUserId: ADMIN, commentId: NEWEST_A, updatedAtMs: NOW + 1 }),
    ).resolves.toEqual({ kind: "authorization_denied" });
    expect(await state()).toEqual({ version: 7, comments: 3, votes: 3 });
  });

  it("rolls back the version when the Comment delete fails", async () => {
    await testEnv.DB.prepare(
      "CREATE TRIGGER test_comment_delete_failure BEFORE DELETE ON vote_comment BEGIN SELECT RAISE(ABORT, 'forced_comment_delete_failure'); END",
    ).run();
    const persistence = createCommentModerationPersistence(testEnv.DB);
    await expect(
      persistence.deleteForOwner({ actorUserId: OWNER, commentId: NEWEST_A, updatedAtMs: NOW + 1 }),
    ).rejects.toThrow(/forced_comment_delete_failure/);
    expect(await state()).toEqual({ version: 7, comments: 3, votes: 3 });
  });

  it("does not mutate when canonical redirect truth is malformed", async () => {
    await testEnv.DB.prepare(
      "UPDATE poll_reference SET reference = '' WHERE poll_id = ?1 AND is_canonical = 1",
    ).bind(POLL_ID).run();
    const persistence = createCommentModerationPersistence(testEnv.DB);
    await expect(
      persistence.deleteForOwner({
        actorUserId: OWNER,
        commentId: NEWEST_A,
        updatedAtMs: NOW + 1,
      }),
    ).rejects.toThrow("Malformed Comment moderation canonical reference");
    expect(await state()).toEqual({ version: 7, comments: 3, votes: 3 });
  });
});
