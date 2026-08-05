// Comment capability (AD-17/AD-19): owns canonical Comment policy, outward
// purpose-shaped views, and the only legal owner/Administrator delete
// commands. Provider-free; D1 implements the ports and Results only consumes
// the read views.

import type {
  ApplicationError,
  Result,
} from "../../shared/application/index";
import type {
  CommentId,
  PollId,
  UserId,
} from "../../shared/domain/index";
import {
  hasAdministratorCapability,
  type UserRole,
} from "../identity/index";

export const COMMENT_CAPS = {
  body: 500,
  displayName: 80,
} as const;

const COMMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;

export function isCommentId(value: unknown): value is CommentId {
  return typeof value === "string" && COMMENT_ID_PATTERN.test(value);
}

export function isCommentTimestamp(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    Number.isFinite(new Date(value).getTime())
  );
}

export const COMMENT_COPY = {
  bodyTooLong: `Keep your Comment to ${COMMENT_CAPS.body} characters.`,
  displayNameTooLong: `Keep your display name to ${COMMENT_CAPS.displayName} characters.`,
  unsupportedCharacter: "Remove unsupported characters.",
  disabled: "Comments aren't enabled for this Poll.",
  heading: "COMMENTS",
  anonymous: "ANONYMOUS",
  delete: "DELETE COMMENT",
  deleteTitle: "DELETE THIS COMMENT?",
  deleteDescription:
    "This removes the Comment only. The Vote and Tally stay in place.",
  accessRequired: "Administrator access is required.",
  notFound: "That Comment is no longer available.",
  loadFailed: "The Comments couldn't be loaded. Try again.",
  failed: "The Comment couldn't be deleted. Reload before trying again.",
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

// Public Results and live JSON carry only reader-purpose fields. Moderation
// identifiers exist on separate authenticated projections and can therefore
// never be accidentally spread into a public payload.
export type CommentView = {
  body: string;
  displayName: string | null;
  createdAtMs: number;
};

export type OwnerCommentView = CommentView & {
  commentId: CommentId;
};

export type AdministratorCommentView = CommentView & {
  commentId: CommentId;
};

export type CommentResultsProjection = {
  comments: CommentView[];
  ownerComments: OwnerCommentView[] | null;
};

export type CommentModerationActor = {
  userId: UserId;
  role: UserRole;
};

export type DeletedComment = {
  kind: "deleted";
  pollId: PollId;
  canonicalReference: string;
};

export type CommentModerationPersistenceOutcome =
  | DeletedComment
  | { kind: "not_found" }
  | { kind: "authorization_denied" };

export type DeleteCommentPort = (input: {
  actorUserId: UserId;
  commentId: CommentId;
  updatedAtMs: number;
}) => Promise<CommentModerationPersistenceOutcome>;

export type DeleteCommentDeps = {
  deleteComment: DeleteCommentPort;
  nowMs: () => number;
};

export type AdministratorCommentLoadOutcome =
  | { kind: "found"; comments: AdministratorCommentView[] }
  | { kind: "authorization_denied" };

export type LoadAdministratorCommentsPort = (
  actorUserId: UserId,
  pollId: PollId,
) => Promise<AdministratorCommentLoadOutcome>;

export type QueryAdministratorCommentsDeps = {
  loadComments: LoadAdministratorCommentsPort;
};

function authorizationError(): ApplicationError {
  return {
    code: "authorization_denied",
    message: COMMENT_COPY.accessRequired,
  };
}

function notFoundError(): ApplicationError {
  return { code: "comment_not_found", message: COMMENT_COPY.notFound };
}

function persistenceError(): ApplicationError {
  return { code: "comment_moderation_failed", message: COMMENT_COPY.failed };
}

async function deleteComment(
  deps: DeleteCommentDeps,
  actorUserId: UserId,
  commentId: CommentId,
): Promise<Result<DeletedComment>> {
  let outcome: CommentModerationPersistenceOutcome;
  try {
    outcome = await deps.deleteComment({
      actorUserId,
      commentId,
      updatedAtMs: deps.nowMs(),
    });
  } catch {
    return { ok: false, error: persistenceError() };
  }
  if (outcome.kind === "deleted") {
    return { ok: true, value: outcome };
  }
  if (outcome.kind === "authorization_denied") {
    return { ok: false, error: authorizationError() };
  }
  return { ok: false, error: notFoundError() };
}

export async function deleteCommentAsOwner(
  deps: DeleteCommentDeps,
  ownerUserId: UserId,
  commentId: CommentId,
): Promise<Result<DeletedComment>> {
  return deleteComment(deps, ownerUserId, commentId);
}

export async function deleteCommentAsAdministrator(
  deps: DeleteCommentDeps,
  actor: CommentModerationActor,
  commentId: CommentId,
): Promise<Result<DeletedComment>> {
  if (!hasAdministratorCapability(actor)) {
    return { ok: false, error: authorizationError() };
  }
  return deleteComment(deps, actor.userId, commentId);
}

export async function queryCommentsAsAdministrator(
  deps: QueryAdministratorCommentsDeps,
  actor: CommentModerationActor,
  pollId: PollId,
): Promise<Result<AdministratorCommentView[]>> {
  if (!hasAdministratorCapability(actor)) {
    return { ok: false, error: authorizationError() };
  }
  try {
    const outcome = await deps.loadComments(actor.userId, pollId);
    return outcome.kind === "authorization_denied"
      ? { ok: false, error: authorizationError() }
      : { ok: true, value: outcome.comments };
  } catch {
    return { ok: false, error: persistenceError() };
  }
}

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
