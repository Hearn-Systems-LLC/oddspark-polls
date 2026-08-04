import { describe, expect, it } from "vitest";
import {
  MAX_MODERATION_CSRF_TOKEN_LENGTH,
  MAX_MODERATION_TARGET_LENGTH,
  parseModerationForm,
  parseModerationGetQuery,
  parseModerationTarget,
} from "../../src/lib/moderation-form";
import { POLL_CAPS } from "../../src/modules/polls/caps";

const ORIGIN = "https://polls.example";
const GENERATED_REFERENCE = "AbCdEfGhIjKlMnOpQrS-_0";

describe("moderation target parsing", () => {
  it.each([
    ["a", "a"],
    ["my-poll-7", "my-poll-7"],
    ["a".repeat(POLL_CAPS.maxCustomLinkLength), "a".repeat(63)],
    [GENERATED_REFERENCE, GENERATED_REFERENCE],
    [`${ORIGIN}/my-poll-7`, "my-poll-7"],
    [`${ORIGIN}/${GENERATED_REFERENCE}`, GENERATED_REFERENCE],
    [`${ORIGIN}/%6dy-poll-7`, "my-poll-7"],
  ])("accepts %s as the exact reference %s", (target, reference) => {
    expect(parseModerationTarget(target, ORIGIN)).toEqual({
      ok: true,
      value: { reference },
    });
  });

  it("accepts an HTTP same-origin URL for local delivery", () => {
    expect(parseModerationTarget("http://localhost:4321/poll", "http://localhost:4321"))
      .toEqual({ ok: true, value: { reference: "poll" } });
  });

  it.each([
    ["empty", ""],
    ["unsupported type", 7],
    ["short uppercase custom-link variant", "My-Poll"],
    ["oversized custom reference", "a".repeat(POLL_CAPS.maxCustomLinkLength + 1)],
    ["wrong-length generated reference", "A".repeat(21)],
    ["reserved reference", "creator"],
    ["punctuation", "poll.name"],
    ["whitespace", " poll"],
    ["control character", "poll\u0000"],
    ["oversized target", "a".repeat(MAX_MODERATION_TARGET_LENGTH + 1)],
    ["relative URL", "/poll"],
    ["protocol-relative URL", "//polls.example/poll"],
  ])("rejects a %s", (_label, target) => {
    expect(parseModerationTarget(target, ORIGIN)).toEqual({
      ok: false,
      code: "invalid_target",
    });
  });

  it.each([
    ["credentials", "https://user:secret@polls.example/poll"],
    ["query", `${ORIGIN}/poll?preview=1`],
    ["fragment", `${ORIGIN}/poll#section`],
    ["wrong scheme", "http://polls.example/poll"],
    ["wrong host", "https://evil.example/poll"],
    ["wrong port", "https://polls.example:8443/poll"],
    ["malformed percent encoding", `${ORIGIN}/bad%ZZ`],
    ["malformed UTF-8", `${ORIGIN}/%E0%A4%A`],
    ["encoded slash", `${ORIGIN}/poll%2Fresults`],
    ["encoded backslash", `${ORIGIN}/poll%5Cresults`],
    ["literal backslash", `${ORIGIN}/poll\\results`],
    ["extra segment", `${ORIGIN}/poll/results`],
    ["trailing slash", `${ORIGIN}/poll/`],
    ["normalized dot segments", `${ORIGIN}/first/../poll`],
    ["missing segment", `${ORIGIN}`],
  ])("rejects a URL with %s", (_label, target) => {
    expect(parseModerationTarget(target, ORIGIN)).toEqual({
      ok: false,
      code: "invalid_target",
    });
  });
});

describe("moderation GET query parsing", () => {
  it("accepts the empty initial lookup", () => {
    expect(parseModerationGetQuery(new URLSearchParams(), ORIGIN)).toEqual({
      ok: true,
      value: { target: null, outcome: null },
    });
  });

  it.each([
    ["target=my-poll", { target: "my-poll", outcome: null }],
    [
      `target=${encodeURIComponent(`${ORIGIN}/my-poll`)}`,
      { target: "my-poll", outcome: null },
    ],
    [
      "target=my-poll&outcome=delisted",
      { target: "my-poll", outcome: "delisted" },
    ],
    [
      "outcome=cleared&target=my-poll",
      { target: "my-poll", outcome: "cleared" },
    ],
  ])("accepts %s", (query, value) => {
    expect(parseModerationGetQuery(new URLSearchParams(query), ORIGIN)).toEqual({
      ok: true,
      value,
    });
  });

  it.each([
    ["unknown field", "target=my-poll&owner=forged"],
    ["duplicate target", "target=my-poll&target=my-poll"],
    ["duplicate outcome", "target=my-poll&outcome=delisted&outcome=cleared"],
    ["outcome without target", "outcome=delisted"],
    ["empty target", "target="],
    ["empty outcome", "target=my-poll&outcome="],
    ["wrong-case outcome", "target=my-poll&outcome=Delisted"],
    ["unsupported outcome", "target=my-poll&outcome=listed"],
    ["malformed target encoding", "target=%E0%A4%A"],
    ["encoded separator", "target=poll%252Fresults"],
    ["oversized target", `target=${"a".repeat(MAX_MODERATION_TARGET_LENGTH + 1)}`],
  ])("rejects a query with %s", (_label, query) => {
    const parsed = parseModerationGetQuery(new URLSearchParams(query), ORIGIN);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(["invalid_query", "invalid_target"]).toContain(parsed.code);
      expect(parsed).not.toHaveProperty("value");
    }
  });
});

describe("moderation POST form parsing", () => {
  function validForm(): FormData {
    const form = new FormData();
    form.set("intent", "delist");
    form.set("target", "my-poll");
    form.set("csrf_token", "csrf-token");
    return form;
  }

  it.each(["delist", "clear_delisted"] as const)(
    "accepts the exact %s intent",
    (intent) => {
      const form = validForm();
      form.set("intent", intent);

      expect(parseModerationForm(form, ORIGIN)).toEqual({
        ok: true,
        value: {
          intent,
          target: "my-poll",
          csrfToken: "csrf-token",
        },
      });
    },
  );

  it("normalizes only a same-origin URL wrapper", () => {
    const form = validForm();
    form.set("target", `${ORIGIN}/${GENERATED_REFERENCE}`);

    expect(parseModerationForm(form, ORIGIN)).toMatchObject({
      ok: true,
      value: { target: GENERATED_REFERENCE },
    });
  });

  it.each(["intent", "target", "csrf_token"])(
    "rejects a missing %s field",
    (field) => {
      const form = validForm();
      form.delete(field);

      expect(parseModerationForm(form, ORIGIN)).toEqual({
        ok: false,
        code: "invalid_form",
      });
    },
  );

  it.each(["intent", "target", "csrf_token"])(
    "rejects a duplicate %s field",
    (field) => {
      const form = validForm();
      form.append(field, "forged");

      expect(parseModerationForm(form, ORIGIN)).toEqual({
        ok: false,
        code: "invalid_form",
      });
    },
  );

  it.each(["intent", "target", "csrf_token"])(
    "rejects a File-valued %s field",
    (field) => {
      const form = validForm();
      form.set(field, new File(["forged"], "field.txt"));

      expect(parseModerationForm(form, ORIGIN)).toEqual({
        ok: false,
        code: "invalid_form",
      });
    },
  );

  it("rejects unknown fields even when empty", () => {
    const form = validForm();
    form.set("owner", "");

    expect(parseModerationForm(form, ORIGIN)).toEqual({
      ok: false,
      code: "invalid_form",
    });
  });

  it.each(["", "Delist", "clear", "listed"])(
    "rejects the unsupported intent %j",
    (intent) => {
      const form = validForm();
      form.set("intent", intent);

      expect(parseModerationForm(form, ORIGIN)).toEqual({
        ok: false,
        code: "invalid_form",
      });
    },
  );

  it("rejects an invalid target without returning the submitted value", () => {
    const form = validForm();
    form.set("target", "https://evil.example/secret-poll");

    expect(parseModerationForm(form, ORIGIN)).toEqual({
      ok: false,
      code: "invalid_target",
    });
  });

  it.each(["", "x".repeat(MAX_MODERATION_CSRF_TOKEN_LENGTH + 1), "token\u0000"])(
    "rejects the invalid CSRF token %j",
    (token) => {
      const form = validForm();
      form.set("csrf_token", token);

      expect(parseModerationForm(form, ORIGIN)).toEqual({
        ok: false,
        code: "invalid_form",
      });
    },
  );
});
