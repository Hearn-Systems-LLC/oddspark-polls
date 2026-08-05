import { describe, expect, it, vi } from "vitest";
import {
  deleteCommentAsAdministrator,
  deleteCommentAsOwner,
  queryCommentsAsAdministrator,
  type CommentModerationActor,
  type CommentModerationPersistenceOutcome,
} from "../../src/modules/comments/index";
import type { CommentId, PollId, UserId } from "../../src/shared/domain/index";

const COMMENT_ID = "comment-1" as CommentId;
const POLL_ID = "poll-1" as PollId;
const OWNER = "owner-1" as UserId;
const ADMIN = "admin-1" as UserId;
const NOW = 1_800_000_000_000;
const administrator: CommentModerationActor = {
  userId: ADMIN,
  role: "administrator",
};

describe("Comment moderation commands", () => {
  it("keeps owner and Administrator commands on separate typed ports", async () => {
    const ownerDelete = vi.fn(async (): Promise<CommentModerationPersistenceOutcome> => ({
      kind: "deleted",
      pollId: POLL_ID,
      canonicalReference: "poll-link",
    }));
    const administratorDelete = vi.fn(async (): Promise<CommentModerationPersistenceOutcome> => ({
      kind: "deleted",
      pollId: POLL_ID,
      canonicalReference: "poll-link",
    }));

    await expect(
      deleteCommentAsOwner(
        { deleteComment: ownerDelete, nowMs: () => NOW },
        OWNER,
        COMMENT_ID,
      ),
    ).resolves.toMatchObject({ ok: true, value: { kind: "deleted" } });
    await expect(
      deleteCommentAsAdministrator(
        { deleteComment: administratorDelete, nowMs: () => NOW },
        administrator,
        COMMENT_ID,
      ),
    ).resolves.toMatchObject({ ok: true, value: { kind: "deleted" } });

    expect(ownerDelete).toHaveBeenCalledWith({
      actorUserId: OWNER,
      commentId: COMMENT_ID,
      updatedAtMs: NOW,
    });
    expect(administratorDelete).toHaveBeenCalledWith({
      actorUserId: ADMIN,
      commentId: COMMENT_ID,
      updatedAtMs: NOW,
    });
  });

  it("denies a forged Administrator role before reading or deleting", async () => {
    const loadComments = vi.fn();
    const deleteComment = vi.fn();
    const creator = { userId: OWNER, role: "creator" } as const;

    await expect(
      queryCommentsAsAdministrator({ loadComments }, creator, POLL_ID),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "authorization_denied" },
    });
    await expect(
      deleteCommentAsAdministrator(
        { deleteComment, nowMs: () => NOW },
        creator,
        COMMENT_ID,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "authorization_denied" },
    });
    expect(loadComments).not.toHaveBeenCalled();
    expect(deleteComment).not.toHaveBeenCalled();
  });

  it("maps safe not-found and persistence outcomes without exposing Comment facts", async () => {
    await expect(
      deleteCommentAsOwner(
        {
          deleteComment: async () => ({ kind: "not_found" }),
          nowMs: () => NOW,
        },
        OWNER,
        COMMENT_ID,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "comment_not_found" },
    });

    await expect(
      deleteCommentAsOwner(
        {
          deleteComment: async () => {
            throw new Error("body and id must stay private");
          },
          nowMs: () => NOW,
        },
        OWNER,
        COMMENT_ID,
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "comment_moderation_failed",
        message: "The Comment couldn't be deleted. Reload before trying again.",
      },
    });
  });
});
