import { isCommentId } from "../modules/comments/index";
import type { CommentId } from "../shared/domain/index";

export const MAX_COMMENT_MODERATION_CSRF_LENGTH = 128;

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u;

export type CommentModerationMode = "owner" | "administrator";

export type ParsedCommentModerationForm = {
  mode: CommentModerationMode;
  commentId: CommentId;
  csrfToken: string;
};

export type CommentModerationParseResult =
  | { ok: true; value: ParsedCommentModerationForm }
  | { ok: false; code: "invalid_comment_moderation_form" };

export function parseCommentModerationForm(
  formData: FormData,
): CommentModerationParseResult {
  const allowed = new Set(["mode", "comment_id", "csrf_token"]);
  const values = new Map<string, string>();
  for (const [key, value] of formData.entries()) {
    if (!allowed.has(key) || values.has(key) || typeof value !== "string") {
      return { ok: false, code: "invalid_comment_moderation_form" };
    }
    values.set(key, value);
  }
  if (values.size !== allowed.size) {
    return { ok: false, code: "invalid_comment_moderation_form" };
  }
  const mode = values.get("mode");
  const commentId = values.get("comment_id");
  const csrfToken = values.get("csrf_token");
  if (
    (mode !== "owner" && mode !== "administrator") ||
    commentId === undefined ||
    !isCommentId(commentId) ||
    csrfToken === undefined ||
    csrfToken.length === 0 ||
    csrfToken.length > MAX_COMMENT_MODERATION_CSRF_LENGTH ||
    CONTROL_CHARACTER.test(csrfToken)
  ) {
    return { ok: false, code: "invalid_comment_moderation_form" };
  }
  return {
    ok: true,
    value: { mode, commentId, csrfToken },
  };
}
