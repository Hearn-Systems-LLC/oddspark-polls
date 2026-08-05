import { describe, expect, it } from "vitest";
import { parseCommentModerationForm } from "../../src/lib/comment-moderation-form";

function form(mode: "owner" | "administrator" = "owner"): FormData {
  const data = new FormData();
  data.set("mode", mode);
  data.set("comment_id", "comment-1");
  data.set("csrf_token", "csrf-token");
  return data;
}

describe("Comment moderation form parsing", () => {
  it.each(["owner", "administrator"] as const)(
    "accepts the exact fixed-field %s form",
    (mode) => {
      expect(parseCommentModerationForm(form(mode))).toMatchObject({
        ok: true,
        value: { mode, commentId: "comment-1", csrfToken: "csrf-token" },
      });
    },
  );

  it.each(["mode", "comment_id", "csrf_token"])(
    "rejects a missing or duplicate %s",
    (field) => {
      const missing = form();
      missing.delete(field);
      expect(parseCommentModerationForm(missing).ok).toBe(false);
      const duplicate = form();
      duplicate.append(field, "forged");
      expect(parseCommentModerationForm(duplicate).ok).toBe(false);
    },
  );

  it("rejects unknown, File-valued, control-character, and oversized inputs", () => {
    const unknown = form();
    unknown.set("return_to", "https://evil.example/private-reference");
    expect(parseCommentModerationForm(unknown).ok).toBe(false);

    const file = form();
    file.set("comment_id", new File(["secret"], "id.txt"));
    expect(parseCommentModerationForm(file).ok).toBe(false);

    const control = form();
    control.set("csrf_token", "bad\ntoken");
    expect(parseCommentModerationForm(control).ok).toBe(false);

    const oversized = form();
    oversized.set("csrf_token", "x".repeat(129));
    expect(parseCommentModerationForm(oversized).ok).toBe(false);
  });
});
