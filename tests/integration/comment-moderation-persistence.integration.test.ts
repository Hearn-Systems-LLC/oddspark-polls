import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createCommentModerationPersistence } from "../../src/adapters/d1/index";
import type { RequestContext } from "../../src/lib/request-context";
import { POST as deleteCommentRoute } from "../../src/pages/creator/comments/delete";
import type { CommentId, PollId, UserId } from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as MigrationTestEnv;
const POLL_ID = "comment-moderation-poll" as PollId;
const OWNER = "comment-moderation-owner" as UserId;
const OTHER = "comment-moderation-other" as UserId;
const ADMIN = "comment-moderation-admin" as UserId;
const COMMENT_ID = "comment-moderation-comment" as CommentId;
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
    testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('comment-vote', ?1, 'comment-submission', 'comment-hash', ?2)",
    ).bind(POLL_ID, NOW),
    testEnv.DB.prepare(
      "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('comment-vote', 'comment-option')",
    ),
    testEnv.DB.prepare(
      "INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES (?1, 'comment-vote', 'Keep the Vote', NULL, ?2)",
    ).bind(COMMENT_ID, NOW),
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

describe("Comment moderation D1 transaction", () => {
  it("lets the owner delete only the Comment and increments the version once", async () => {
    const persistence = createCommentModerationPersistence(testEnv.DB);
    await expect(
      persistence.deleteForOwner({ actorUserId: OWNER, commentId: COMMENT_ID, updatedAtMs: NOW + 1 }),
    ).resolves.toEqual({
      kind: "deleted",
      pollId: POLL_ID,
      canonicalReference: "comment-moderation-ref",
    });
    expect(await state()).toEqual({ version: 8, comments: 0, votes: 1 });
  });

  it("keeps denied, stale, and concurrent losers as no-op outcomes", async () => {
    const persistence = createCommentModerationPersistence(testEnv.DB);
    await expect(
      persistence.deleteForOwner({ actorUserId: OTHER, commentId: COMMENT_ID, updatedAtMs: NOW + 1 }),
    ).resolves.toEqual({ kind: "not_found" });
    expect(await state()).toEqual({ version: 7, comments: 1, votes: 1 });

    const outcomes = await Promise.all([
      persistence.deleteForOwner({ actorUserId: OWNER, commentId: COMMENT_ID, updatedAtMs: NOW + 2 }),
      persistence.deleteForOwner({ actorUserId: OWNER, commentId: COMMENT_ID, updatedAtMs: NOW + 3 }),
    ]);
    expect(outcomes.map(({ kind }) => kind).sort()).toEqual(["deleted", "not_found"]);
    expect(await state()).toEqual({ version: 8, comments: 0, votes: 1 });
  });

  it("rechecks the live Administrator role for reads and deletes", async () => {
    const persistence = createCommentModerationPersistence(testEnv.DB);
    await expect(persistence.loadForAdministrator(ADMIN, POLL_ID)).resolves.toEqual({
      kind: "found",
      comments: [{
        commentId: COMMENT_ID,
        body: "Keep the Vote",
        displayName: null,
        createdAtMs: NOW,
      }],
    });
    await testEnv.DB.prepare("UPDATE user SET role = 'creator' WHERE id = ?1").bind(ADMIN).run();
    await expect(persistence.loadForAdministrator(ADMIN, POLL_ID)).resolves.toEqual({ kind: "authorization_denied" });
    await expect(
      persistence.deleteForAdministrator({ actorUserId: ADMIN, commentId: COMMENT_ID, updatedAtMs: NOW + 1 }),
    ).resolves.toEqual({ kind: "authorization_denied" });
    expect(await state()).toEqual({ version: 7, comments: 1, votes: 1 });
  });

  it("rolls back the version when the Comment delete fails", async () => {
    await testEnv.DB.prepare(
      "CREATE TRIGGER test_comment_delete_failure BEFORE DELETE ON vote_comment BEGIN SELECT RAISE(ABORT, 'forced_comment_delete_failure'); END",
    ).run();
    const persistence = createCommentModerationPersistence(testEnv.DB);
    await expect(
      persistence.deleteForOwner({ actorUserId: OWNER, commentId: COMMENT_ID, updatedAtMs: NOW + 1 }),
    ).rejects.toThrow(/forced_comment_delete_failure/);
    expect(await state()).toEqual({ version: 7, comments: 1, votes: 1 });
  });
});

describe("Comment moderation route", () => {
  function context(
    actor: UserId,
    role: "creator" | "administrator",
    mode: "owner" | "administrator" = "owner",
  ): Parameters<typeof deleteCommentRoute>[0] {
    const body = new FormData();
    body.set("mode", mode);
    body.set("comment_id", COMMENT_ID);
    body.set("csrf_token", "csrf-token");
    const requestContext: RequestContext = {
      requestId: "comment-moderation-request",
      startedAtMs: NOW,
      principal: {
        userId: actor,
        role,
        session: {
          id: "session",
          userId: actor,
          token: "never-logged",
          expiresAt: new Date(NOW + 60_000),
          createdAt: new Date(NOW),
          updatedAt: new Date(NOW),
        },
      },
      csrfToken: {
        value: "csrf-token",
        headerName: "x-oddspark-csrf",
        formFieldName: "csrf_token",
      },
      pollId: null,
      sessionExpired: false,
      sessionLookupFailed: false,
      csrfRejected: false,
      authorizationDenied: false,
      resultsLookupFailed: false,
      demoUnavailable: false,
      voteRejection: false,
      providerOutcome: "none",
    };
    return {
      request: new Request("https://polls.example/creator/comments/delete", {
        method: "POST",
        body,
      }),
      locals: { requestContext, principal: requestContext.principal },
    } as Parameters<typeof deleteCommentRoute>[0];
  }

  it("uses POST-redirect-GET without reflecting Comment facts", async () => {
    const response = await deleteCommentRoute(context(OWNER, "creator"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/comment-moderation-ref/results",
    );
    expect(await response.text()).toBe("");
    expect(await state()).toEqual({ version: 8, comments: 0, votes: 1 });
  });

  it("returns a non-reflecting 404 for a stale Comment instead of claiming success", async () => {
    const first = await deleteCommentRoute(context(OWNER, "creator"));
    expect(first.status).toBe(303);

    const stale = await deleteCommentRoute(context(OWNER, "creator"));
    expect(stale.status).toBe(404);
    expect(stale.headers.get("location")).toBeNull();
    expect(stale.headers.get("cache-control")).toBe("private, no-store");
    expect(await stale.text()).toBe("That Comment is no longer available.");
    expect(await state()).toEqual({ version: 8, comments: 0, votes: 1 });
  });

  it("derives the Administrator redirect from D1 canonical truth", async () => {
    const response = await deleteCommentRoute(
      context(ADMIN, "administrator", "administrator"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/creator/moderation?target=comment-moderation-ref",
    );
  });

  it("denies a revoked Administrator before mutation without target disclosure", async () => {
    await testEnv.DB.prepare("UPDATE user SET role = 'creator' WHERE id = ?1").bind(ADMIN).run();
    const response = await deleteCommentRoute(
      context(ADMIN, "administrator", "administrator"),
    );
    expect(response.status).toBe(403);
    expect(await response.text()).toBe("Administrator access is required.");
    expect(await state()).toEqual({ version: 7, comments: 1, votes: 1 });
  });

  it("rejects an extra field before the command", async () => {
    const ctx = context(OWNER, "creator");
    const body = await ctx.request.formData();
    body.set("return_to", "https://evil.example/must-not-echo");
    ctx.request = new Request(ctx.request.url, { method: "POST", body });
    const response = await deleteCommentRoute(ctx);
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain("must-not-echo");
    expect(await state()).toEqual({ version: 7, comments: 1, votes: 1 });
  });
});
