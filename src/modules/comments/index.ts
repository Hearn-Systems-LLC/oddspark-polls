import type { Result } from "../../shared/application/index";

export const COMMENT_CAPS = {
  body: 500,
  displayName: 80,
} as const;

export const COMMENT_COPY = {
  bodyTooLong: `Keep your Comment to ${COMMENT_CAPS.body} characters.`,
  displayNameTooLong: `Keep your display name to ${COMMENT_CAPS.displayName} characters.`,
  unsupportedCharacter: "Remove unsupported characters.",
  disabled: "Comments aren't enabled for this Poll.",
} as const;

export type CommentDraft = {
  body: string;
  displayName: string;
};

export type CanonicalComment = {
  body: string;
  displayName: string | null;
};

export type VoteCommentContribution = {
  kind: "vote_comment";
  id: string;
  voteId: string;
  body: string;
  displayName: string | null;
  createdAtMs: number;
};

/**
 * Canonical Comment policy. JavaScript string length is intentionally used:
 * the product limit is UTF-16 code units, matching browser maxlength.
 */
export function normalizeComment(
  draft: CommentDraft,
): Result<CanonicalComment | null> {
  // Native form encoding expands textarea newlines to CRLF. Collapse them
  // back to the DOM's LF representation before applying the browser-aligned
  // UTF-16 cap, hashing, and persistence.
  const body = draft.body.replace(/\r\n?/g, "\n").trim();
  const displayName = draft.displayName.trim();

  // A display name has no independent meaning. Discard it before validating
  // its bound when the Comment body is blank so name-only input cannot block
  // an otherwise valid Vote.
  if (body.length === 0) {
    return { ok: true, value: null };
  }

  const fieldErrors: Record<string, string> = {};
  const reasonCodes: Record<string, string> = {};

  if (body.length > COMMENT_CAPS.body) {
    fieldErrors.comment = COMMENT_COPY.bodyTooLong;
    reasonCodes.comment = "comment_too_long";
  }
  if (body.includes("\0")) {
    fieldErrors.comment = COMMENT_COPY.unsupportedCharacter;
    reasonCodes.comment = "comment_unsupported_character";
  }
  if (displayName.length > COMMENT_CAPS.displayName) {
    fieldErrors.displayName = COMMENT_COPY.displayNameTooLong;
    reasonCodes.displayName = "display_name_too_long";
  }
  if (displayName.includes("\0")) {
    fieldErrors.displayName = COMMENT_COPY.unsupportedCharacter;
    reasonCodes.displayName = "display_name_unsupported_character";
  }
  if (/[\r\n]/.test(displayName)) {
    fieldErrors.displayName = COMMENT_COPY.unsupportedCharacter;
    reasonCodes.displayName = "display_name_unsupported_character";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      error: {
        code: "comment_validation_failed",
        message: "Fix the fields below.",
        fieldErrors,
        reasonCodes,
      },
    };
  }

  return {
    ok: true,
    value: {
      body,
      displayName: displayName.length > 0 ? displayName : null,
    },
  };
}

export function makeVoteCommentContribution(
  comment: CanonicalComment,
  input: { id: string; voteId: string; createdAtMs: number },
): VoteCommentContribution {
  return {
    kind: "vote_comment",
    id: input.id,
    voteId: input.voteId,
    body: comment.body,
    displayName: comment.displayName,
    createdAtMs: input.createdAtMs,
  };
}
