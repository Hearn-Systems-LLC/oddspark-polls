import { describe, expect, it } from "vitest";
import {
  COMMENT_COPY,
  makeVoteCommentContribution,
  normalizeComment,
} from "../../src/modules/comments/index";

describe("Comment contribution policy", () => {
  it("trims a Comment and optional display name", () => {
    expect(normalizeComment({ body: "  useful context  ", displayName: "  Jo  " })).toEqual({
      ok: true,
      value: { body: "useful context", displayName: "Jo" },
    });
  });

  it("treats a blank Comment as absent and discards a name-only value", () => {
    expect(normalizeComment({ body: " \n ", displayName: "Jo" })).toEqual({
      ok: true,
      value: null,
    });
    expect(
      normalizeComment({ body: " \n ", displayName: "n".repeat(81) }),
    ).toEqual({ ok: true, value: null });
  });

  it("accepts the exact UTF-16 boundaries", () => {
    const result = normalizeComment({ body: "x".repeat(500), displayName: "n".repeat(80) });
    expect(result.ok).toBe(true);
  });

  it("canonicalizes browser CRLF line endings before counting and hashing", () => {
    const body = `${"x\r\n".repeat(249)}x`;
    expect(body).toHaveLength(748);
    expect(normalizeComment({ body, displayName: "Jo" })).toEqual({
      ok: true,
      value: { body: `${"x\n".repeat(249)}x`, displayName: "Jo" },
    });
  });

  it("rejects either over-limit field with stable field errors", () => {
    expect(normalizeComment({ body: "x".repeat(501), displayName: "n".repeat(81) })).toEqual({
      ok: false,
      error: {
        code: "comment_validation_failed",
        message: "Fix the fields below.",
        fieldErrors: {
          comment: COMMENT_COPY.bodyTooLong,
          displayName: COMMENT_COPY.displayNameTooLong,
        },
        reasonCodes: {
          comment: "comment_too_long",
          displayName: "display_name_too_long",
        },
      },
    });
  });

  it("rejects NUL characters before they reach SQLite text checks", () => {
    expect(normalizeComment({ body: "context\0hidden", displayName: "Jo\0" })).toEqual({
      ok: false,
      error: {
        code: "comment_validation_failed",
        message: "Fix the fields below.",
        fieldErrors: {
          comment: COMMENT_COPY.unsupportedCharacter,
          displayName: COMMENT_COPY.unsupportedCharacter,
        },
        reasonCodes: {
          comment: "comment_unsupported_character",
          displayName: "display_name_unsupported_character",
        },
      },
    });
  });

  it("rejects multiline display names from forged requests", () => {
    expect(
      normalizeComment({ body: "Context", displayName: "Jo\r\nAdmin" }),
    ).toMatchObject({
      ok: false,
      error: {
        fieldErrors: { displayName: COMMENT_COPY.unsupportedCharacter },
        reasonCodes: {
          displayName: "display_name_unsupported_character",
        },
      },
    });
  });

  it("maps only canonical text into a typed Vote contribution", () => {
    expect(
      makeVoteCommentContribution(
        { body: "Context", displayName: null },
        { id: "comment-1", voteId: "vote-1", createdAtMs: 10 },
      ),
    ).toEqual({
      kind: "vote_comment",
      id: "comment-1",
      voteId: "vote-1",
      body: "Context",
      displayName: null,
      createdAtMs: 10,
    });
  });
});
