import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CIVIL_TIME_NONEXISTENT,
  CREATE_POLL_COPY,
  DuplicatePollIdError,
  POLL_CAPS,
  civilToUtcMs,
  createPoll,
  generatePollReference,
  validateCreatePoll,
  type CreatePollDraft,
  type ExistingPollSnapshot,
  type PollPersistenceRows,
} from "../../src/modules/polls/index";
import { isReservedSlug } from "../../src/modules/polls/reserved-slugs";
import { multipleChoiceStrategy } from "../../src/modules/polls/types/multiple-choice";
import type { UserId } from "../../src/shared/domain/index";

const NOW = Date.UTC(2026, 6, 29, 12, 0, 0);
const USER_1 = "user-1" as UserId;

afterEach(() => {
  vi.restoreAllMocks();
});

function draft(overrides: Partial<CreatePollDraft> = {}): CreatePollDraft {
  return {
    question: "Where should we eat?",
    description: "",
    options: ["Pizza", "Tacos"],
    resultVisibility: "live",
    deadlineLocal: "",
    timeZone: "",
    ...overrides,
  };
}

function expectFieldError(
  input: CreatePollDraft,
  field: string,
  messageStart: string,
): void {
  const result = validateCreatePoll(input, NOW);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.fieldErrors?.[field]).toMatch(
      new RegExp(`^${messageStart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
    );
  }
}

describe("validateCreatePoll", () => {
  it("accepts a minimal valid draft and normalizes it", () => {
    const result = validateCreatePoll(draft(), NOW);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        question: "Where should we eat?",
        description: null,
        options: [
          { label: "Pizza", position: 0 },
          { label: "Tacos", position: 1 },
        ],
        resultVisibility: "live",
        deadlineMs: null,
      });
    }
  });

  it("ignores blank option rows (blank = removed)", () => {
    const result = validateCreatePoll(
      draft({ options: ["", "  ", "Pizza", "", "Tacos", "   "] }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.options).toEqual([
        { label: "Pizza", position: 0 },
        { label: "Tacos", position: 1 },
      ]);
    }
  });

  it("trims question, options, and description", () => {
    const result = validateCreatePoll(
      draft({ question: "  Q?  ", options: [" A ", " B "], description: " d " }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.question).toBe("Q?");
      expect(result.value.options[0]?.label).toBe("A");
      expect(result.value.description).toBe("d");
    }
  });

  it("rejects zero options with the exact Voice line", () => {
    expectFieldError(draft({ options: ["", ""] }), "options", "A Poll needs options. Add at least two.");
  });

  it("rejects a single option with the exact Voice line", () => {
    expectFieldError(draft({ options: ["Pizza", " "] }), "options", "One option isn't a Poll. Add at least one more.");
  });

  it("rejects more than 30 non-blank options", () => {
    const options = Array.from({ length: 31 }, (_, i) => `Option ${i}`);
    expectFieldError(draft({ options }), "options", "That's too many options.");
  });

  it("accepts exactly 30 options", () => {
    const options = Array.from({ length: 30 }, (_, i) => `Option ${i}`);
    expect(validateCreatePoll(draft({ options }), NOW).ok).toBe(true);
  });

  it("rejects exact duplicate option labels after trimming", () => {
    expectFieldError(
      draft({ options: ["Pizza", " Pizza "] }),
      "options",
      "Two options say the same thing.",
    );
  });

  it("rejects a blank question", () => {
    expectFieldError(draft({ question: "   " }), "question", "A Poll needs a question.");
  });

  it("enforces the question cap at the boundary", () => {
    expect(
      validateCreatePoll(draft({ question: "q".repeat(280) }), NOW).ok,
    ).toBe(true);
    expectFieldError(
      draft({ question: "q".repeat(281) }),
      "question",
      "That question is too long.",
    );
  });

  it("counts characters as code points, so emoji count as one", () => {
    expect(
      validateCreatePoll(draft({ question: "🍕".repeat(280) }), NOW).ok,
    ).toBe(true);
    expectFieldError(
      draft({ question: "🍕".repeat(281) }),
      "question",
      "That question is too long.",
    );
    expectFieldError(
      draft({ options: ["🍕".repeat(101), "B"] }),
      "options",
      "That option is too long.",
    );
    expect(
      validateCreatePoll(draft({ options: ["🍕".repeat(100), "B"] }), NOW).ok,
    ).toBe(true);
  });

  it("enforces the option label cap at the boundary", () => {
    expect(
      validateCreatePoll(draft({ options: ["o".repeat(100), "B"] }), NOW).ok,
    ).toBe(true);
    expectFieldError(
      draft({ options: ["o".repeat(101), "B"] }),
      "options",
      "That option is too long.",
    );
  });

  it("enforces the description cap at the boundary", () => {
    expect(
      validateCreatePoll(draft({ description: "d".repeat(5000) }), NOW).ok,
    ).toBe(true);
    expectFieldError(
      draft({ description: "d".repeat(5001) }),
      "description",
      "That description is too long.",
    );
  });

  it("rejects an unknown visibility value", () => {
    expectFieldError(
      draft({ resultVisibility: "everyone" }),
      "visibility",
      "Pick a Visibility Setting.",
    );
  });

  it("rejects a past deadline with the exact Voice line", () => {
    expectFieldError(
      draft({ deadlineLocal: "2026-07-29T11:00", timeZone: "UTC" }),
      "deadline",
      "That Deadline has already passed. The Poll would close before anyone saw it.",
    );
  });

  it("accepts a future deadline and converts it to UTC ms", () => {
    const result = validateCreatePoll(
      draft({ deadlineLocal: "2026-07-30T12:00", timeZone: "UTC" }),
      NOW,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.deadlineMs).toBe(Date.UTC(2026, 6, 30, 12, 0, 0));
    }
  });

  it("rejects an unparseable deadline", () => {
    expectFieldError(
      draft({ deadlineLocal: "not-a-date", timeZone: "UTC" }),
      "deadline",
      "That Deadline didn't parse.",
    );
  });

  it("rejects a spring-forward gap deadline with its own Voice line", () => {
    expectFieldError(
      draft({ deadlineLocal: "2026-03-08T02:30", timeZone: "America/New_York" }),
      "deadline",
      "That Deadline never happens — the clock skips right over it.",
    );
  });

  it("reports multiple field errors in one 422 pass", () => {
    const result = validateCreatePoll(
      draft({ question: "", options: ["Only"] }),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.error.fieldErrors ?? {})).toEqual(
        expect.arrayContaining(["question", "options"]),
      );
    }
  });

  it("tags every field failure with a stable reason code alongside the copy", () => {
    const result = validateCreatePoll(
      draft({ question: "", deadlineLocal: "2026-07-28T12:00", timeZone: "UTC" }),
      NOW,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reasonCodes).toEqual({
        question: "question_missing",
        deadline: "deadline_past",
      });
    }
  });

  // Every validation failure emits exactly one reason code, keyed by the
  // same field as its fieldErrors entry.
  it.each([
    ["question_missing", "question", draft({ question: "" })],
    ["question_too_long", "question", draft({ question: "q".repeat(281) })],
    ["options_missing", "options", draft({ options: ["", ""] })],
    ["options_insufficient", "options", draft({ options: ["Pizza", " "] })],
    [
      "options_too_many",
      "options",
      draft({ options: Array.from({ length: 31 }, (_, i) => `Option ${i}`) }),
    ],
    ["option_too_long", "options", draft({ options: ["o".repeat(101), "B"] })],
    ["options_duplicate", "options", draft({ options: ["Pizza", " Pizza "] })],
    ["description_too_long", "description", draft({ description: "d".repeat(5001) })],
    ["visibility_invalid", "visibility", draft({ resultVisibility: "everyone" })],
    [
      "deadline_past",
      "deadline",
      draft({ deadlineLocal: "2026-07-28T12:00", timeZone: "UTC" }),
    ],
    [
      "deadline_unparseable",
      "deadline",
      draft({ deadlineLocal: "not-a-date", timeZone: "UTC" }),
    ],
    [
      "deadline_nonexistent",
      "deadline",
      draft({ deadlineLocal: "2026-03-08T02:30", timeZone: "America/New_York" }),
    ],
  ])("tags %s on the %s field", (reason, field, input) => {
    const result = validateCreatePoll(input, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reasonCodes).toEqual({ [field]: reason });
      expect(Object.keys(result.error.reasonCodes ?? {}).sort()).toEqual(
        Object.keys(result.error.fieldErrors ?? {}).sort(),
      );
    }
  });
});

describe("civilToUtcMs", () => {
  it("interprets the civil time in the given IANA zone", () => {
    // 2026-07-30 12:00 in New York (EDT, UTC-4) = 16:00 UTC.
    expect(civilToUtcMs("2026-07-30T12:00", "America/New_York")).toBe(
      Date.UTC(2026, 6, 30, 16, 0, 0),
    );
  });

  it("falls back to UTC when no zone is provided (no-JS baseline)", () => {
    expect(civilToUtcMs("2026-07-30T12:00", null)).toBe(
      Date.UTC(2026, 6, 30, 12, 0, 0),
    );
  });

  it("falls back to UTC for an invalid zone", () => {
    expect(civilToUtcMs("2026-07-30T12:00", "Not/AZone")).toBe(
      Date.UTC(2026, 6, 30, 12, 0, 0),
    );
  });

  it("handles a winter (non-DST) instant in a DST zone", () => {
    // 2026-12-30 12:00 in New York (EST, UTC-5) = 17:00 UTC.
    expect(civilToUtcMs("2026-12-30T12:00", "America/New_York")).toBe(
      Date.UTC(2026, 11, 30, 17, 0, 0),
    );
  });

  it("returns a distinct outcome for a spring-forward gap time that never exists", () => {
    // 2026-03-08 02:30 never happens in New York (clocks jump 02:00 → 03:00).
    expect(civilToUtcMs("2026-03-08T02:30", "America/New_York")).toBe(
      CIVIL_TIME_NONEXISTENT,
    );
  });

  it("resolves a fall-back ambiguous time to its first occurrence", () => {
    // 2026-11-01 01:30 happens twice in New York; the first is EDT (UTC-4).
    const resolved = civilToUtcMs("2026-11-01T01:30", "America/New_York");
    expect(resolved).toBe(Date.UTC(2026, 10, 1, 5, 30, 0));
  });

  it("passes a seconds-bearing datetime-local value through to the conversion", () => {
    expect(civilToUtcMs("2026-07-30T12:00:45", "UTC")).toBe(
      Date.UTC(2026, 6, 30, 12, 0, 45),
    );
  });

  it("truncates fractional seconds to whole seconds", () => {
    expect(civilToUtcMs("2026-07-30T12:00:45.987", "UTC")).toBe(
      Date.UTC(2026, 6, 30, 12, 0, 45),
    );
  });

  it("returns null for garbage input", () => {
    expect(civilToUtcMs("garbage", "UTC")).toBeNull();
    expect(civilToUtcMs("2026-13-40T99:99", "UTC")).toBeNull();
  });
});

describe("generatePollReference (AD-13)", () => {
  it("encodes at least 96 random bits URL-safely with no padding", () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 16, maxLength: 16 }),
        (bytes) => {
          const reference = generatePollReference(bytes);
          expect(reference).toMatch(/^[A-Za-z0-9_-]+$/);
          expect(reference).not.toContain("=");
          // 16 bytes -> 22 base64url chars = 128 bits > 96 required.
          expect(reference).toHaveLength(22);
        },
      ),
    );
  });

  it("round-trips the exact bytes (no information loss)", () => {
    const bytes = new Uint8Array(16).fill(0xab);
    const a = generatePollReference(bytes);
    const b = generatePollReference(bytes);
    expect(a).toBe(b);
    expect(generatePollReference()).not.toBe(a);
  });

  it("never collides across a random sample", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      seen.add(generatePollReference());
    }
    expect(seen.size).toBe(1000);
  });
});

describe("reserved-slug registry (AD-13)", () => {
  it.each([
    "creator",
    "discover",
    "sign-in",
    "assets",
    "api",
    "_astro",
    "favicon.ico",
    "favicon.svg",
    "fonts",
    "robots.txt",
    "sitemap.xml",
    "results",
    "manifest",
    "",
  ])("reserves %j", (slug) => {
    expect(isReservedSlug(slug)).toBe(true);
  });

  it("does not reserve ordinary slugs", () => {
    expect(isReservedSlug("team-lunch")).toBe(false);
    expect(isReservedSlug("abc123")).toBe(false);
  });
});

describe("multipleChoiceStrategy", () => {
  it("normalizes labels into positioned option facts", () => {
    const result = multipleChoiceStrategy.create(
      { optionLabels: ["A", "B", "C"] },
      { nowMs: NOW },
    );
    expect(result).toEqual({
      ok: true,
      value: {
        options: [
          { label: "A", position: 0 },
          { label: "B", position: 1 },
          { label: "C", position: 2 },
        ],
      },
    });
  });
});

describe("createPoll command", () => {
  function deps(persisted: PollPersistenceRows[]) {
    let id = 0;
    return {
      persist: async (rows: PollPersistenceRows) => {
        persisted.push(rows);
      },
      generateId: () => `id-${(id += 1)}`,
      generateReference: () => "ref-abc123",
      nowMs: () => NOW,
    };
  }

  it("commits poll + options + reference rows with the story defaults", async () => {
    const persisted: PollPersistenceRows[] = [];
    const result = await createPoll(deps(persisted), USER_1, draft());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        pollId: "id-1",
        reference: "ref-abc123",
        createdAtMs: NOW,
        existing: false,
      });
    }
    expect(persisted).toHaveLength(1);
    const rows = persisted[0]!;
    expect(rows.poll).toEqual({
      id: "id-1",
      ownerUserId: USER_1,
      pollType: "multiple_choice",
      question: "Where should we eat?",
      description: null,
      resultVisibility: "live",
      discoveryState: "unlisted",
      sessionChecksEnabled: true,
      deadlineMs: null,
      representationVersion: 1,
      createdAtMs: NOW,
    });
    expect(rows.options).toEqual([
      { id: "id-2", pollId: "id-1", label: "Pizza", position: 0, createdAtMs: NOW },
      { id: "id-3", pollId: "id-1", label: "Tacos", position: 1, createdAtMs: NOW },
    ]);
    expect(rows.reference).toEqual({
      reference: "ref-abc123",
      pollId: "id-1",
      kind: "generated",
      createdAtMs: NOW,
    });
  });

  it("does not persist anything when validation fails", async () => {
    const persisted: PollPersistenceRows[] = [];
    const result = await createPoll(deps(persisted), USER_1, draft({ options: [] }));
    expect(result.ok).toBe(false);
    expect(persisted).toHaveLength(0);
  });

  it("regenerates when the generator first returns a reserved slug", async () => {
    const persisted: PollPersistenceRows[] = [];
    const generated: string[] = [];
    const result = await createPoll(
      {
        ...deps(persisted),
        generateReference: () => {
          generated.push("called");
          return generated.length === 1 ? "creator" : "ref-good";
        },
      },
      USER_1,
      draft(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.reference).toBe("ref-good");
    }
    expect(persisted[0]?.reference.reference).toBe("ref-good");
    expect(generated).toHaveLength(2);
  });

  it("fails the create after three reserved-slug draws instead of looping", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const persisted: PollPersistenceRows[] = [];
    let draws = 0;
    const result = await createPoll(
      {
        ...deps(persisted),
        generateReference: () => {
          draws += 1;
          return "creator";
        },
      },
      USER_1,
      draft(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_create_failed");
    }
    expect(draws).toBe(3);
    expect(persisted).toHaveLength(0);
    // The bail-out logs through the same diagnostic path as other failures.
    expect(errorSpy).toHaveBeenCalledWith("poll_create_failed", {
      pollId: "id-1",
      cause: "reference generator returned reserved slugs after 3 draws",
    });
  });

  it("uses a valid draft idempotency ID as the poll's ID", async () => {
    const persisted: PollPersistenceRows[] = [];
    const id = "3f6b2c90-9a42-4d8e-b7a1-2c4e5f6a7b8c";
    const result = await createPoll(
      deps(persisted),
      USER_1,
      draft({ idempotencyId: id }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pollId).toBe(id);
    }
    expect(persisted[0]?.poll.id).toBe(id);
  });

  it("ignores a malformed idempotency ID and generates a fresh one", async () => {
    const persisted: PollPersistenceRows[] = [];
    const result = await createPoll(
      deps(persisted),
      USER_1,
      draft({ idempotencyId: "not-a-uuid" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pollId).toBe("id-1");
    }
    expect(persisted[0]?.poll.id).toBe("id-1");
  });

  it("maps a persistence failure to a stable code, never SQL detail", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = {
      persist: async () => {
        throw new Error("D1_ERROR: UNIQUE constraint failed: poll_reference.reference");
      },
      generateId: () => "id-1",
      generateReference: () => "ref",
      nowMs: () => NOW,
    };
    const result = await createPoll(failing, USER_1, draft());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_create_failed");
      expect(result.error.message).not.toMatch(/UNIQUE|D1_ERROR|SQL/i);
    }
    // Diagnostics stay server-side: code, poll ID, and driver message only.
    expect(errorSpy).toHaveBeenCalledWith("poll_create_failed", {
      pollId: "id-1",
      cause: "D1_ERROR: UNIQUE constraint failed: poll_reference.reference",
    });
  });
});

describe("createPoll duplicate-ID dedupe (D4)", () => {
  const NONCE = "3f6b2c90-9a42-4d8e-b7a1-2c4e5f6a7b8c";

  function snapshot(overrides: Partial<ExistingPollSnapshot> = {}): ExistingPollSnapshot {
    return {
      question: "Where should we eat?",
      description: null,
      resultVisibility: "live",
      deadlineMs: null,
      options: [
        { label: "Pizza", position: 0 },
        { label: "Tacos", position: 1 },
      ],
      canonicalReference: "ref-abc123",
      createdAtMs: NOW - 60_000,
      ...overrides,
    };
  }

  function duplicateDeps(existing: ExistingPollSnapshot | null) {
    return {
      persist: async () => {
        throw new DuplicatePollIdError(
          "D1_ERROR: UNIQUE constraint failed: poll.id",
        );
      },
      generateId: () => "id-unused",
      generateReference: () => "ref-new",
      nowMs: () => NOW,
      findExistingPoll: async () => existing,
    };
  }

  it("returns the existing Poll when the retry payload is identical", async () => {
    const result = await createPoll(
      duplicateDeps(snapshot()),
      USER_1,
      draft({ idempotencyId: NONCE }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        pollId: NONCE,
        reference: "ref-abc123",
        createdAtMs: NOW - 60_000,
        existing: true,
      });
    }
  });

  it("rejects a divergent resubmission with the duplicate Voice line", async () => {
    const result = await createPoll(
      duplicateDeps(snapshot({ question: "Somewhere else entirely?" })),
      USER_1,
      draft({ idempotencyId: NONCE }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_duplicate_divergent");
      expect(result.error.message).toBe(CREATE_POLL_COPY.duplicateDivergent);
    }
  });

  it("resolves a case-flipped retry nonce to the existing Poll", async () => {
    // The UUID check is case-insensitive but the D1 TEXT key is not — the
    // boundary normalizes to lowercase so an uppercased nonce still dedupes.
    const seen: string[] = [];
    const result = await createPoll(
      {
        ...duplicateDeps(snapshot()),
        findExistingPoll: async (pollId) => {
          seen.push(pollId);
          return snapshot();
        },
      },
      USER_1,
      draft({ idempotencyId: NONCE.toUpperCase() }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.pollId).toBe(NONCE);
      expect(result.value.existing).toBe(true);
    }
    expect(seen).toEqual([NONCE]);
  });

  it("treats reordered or retyped options as divergent", async () => {
    const result = await createPoll(
      duplicateDeps(
        snapshot({
          options: [
            { label: "Tacos", position: 0 },
            { label: "Pizza", position: 1 },
          ],
        }),
      ),
      USER_1,
      draft({ idempotencyId: NONCE }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_duplicate_divergent");
    }
  });

  it("contains a failed existing-Poll lookup to the unconfirmable-retry copy", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const failingLookup = {
      ...duplicateDeps(null),
      findExistingPoll: async () => {
        throw new Error("D1_ERROR: connection lost");
      },
    };
    const result = await createPoll(
      failingLookup,
      USER_1,
      draft({ idempotencyId: NONCE }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_create_failed");
      // "Nothing was created" would be a lie here — the Poll may exist.
      expect(result.error.message).toBe(CREATE_POLL_COPY.dedupeUnconfirmable);
    }
    expect(errorSpy).toHaveBeenCalledOnce();
  });

  it("maps a collision whose poll is not the caller's to the unconfirmable copy", async () => {
    // A forged nonce collides with someone else's Poll — the owner-scoped
    // lookup returns null and the generic mapping keeps the detail server-side.
    const result = await createPoll(
      duplicateDeps(null),
      USER_1,
      draft({ idempotencyId: NONCE }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_create_failed");
      expect(result.error.message).toBe(CREATE_POLL_COPY.dedupeUnconfirmable);
    }
  });
});

describe("createPoll retry-after-deadline dedupe", () => {
  const NONCE = "3f6b2c90-9a42-4d8e-b7a1-2c4e5f6a7b8c";
  const DEADLINE_MS = Date.UTC(2026, 6, 30, 12, 0, 0);
  // Two days after the poll's own deadline — a retry of that poll arrives
  // with deadlinePast as its only validation failure.
  const LATER = Date.UTC(2026, 7, 1, 12, 0, 0);

  function afterDeadlineDeps(existing: ExistingPollSnapshot | null) {
    return {
      persist: async () => {
        throw new Error("persist must not run for a failed-validation retry");
      },
      generateId: () => "id-unused",
      generateReference: () => "ref-new",
      nowMs: () => LATER,
      findExistingPoll: async () => existing,
    };
  }

  function afterDeadlineDraft(): CreatePollDraft {
    return draft({
      idempotencyId: NONCE,
      deadlineLocal: "2026-07-30T12:00",
      timeZone: "UTC",
    });
  }

  it("dedupes an identical retry arriving after the poll's own deadline", async () => {
    const existing: ExistingPollSnapshot = {
      question: "Where should we eat?",
      description: null,
      resultVisibility: "live",
      deadlineMs: DEADLINE_MS,
      options: [
        { label: "Pizza", position: 0 },
        { label: "Tacos", position: 1 },
      ],
      canonicalReference: "ref-abc123",
      createdAtMs: NOW,
    };
    const result = await createPoll(
      afterDeadlineDeps(existing),
      USER_1,
      afterDeadlineDraft(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        pollId: NONCE,
        reference: "ref-abc123",
        createdAtMs: NOW,
        existing: true,
      });
    }
  });

  it("returns the divergent error when the after-deadline retry diverges", async () => {
    const divergent: ExistingPollSnapshot = {
      question: "A different question entirely?",
      description: null,
      resultVisibility: "live",
      deadlineMs: DEADLINE_MS,
      options: [
        { label: "Pizza", position: 0 },
        { label: "Tacos", position: 1 },
      ],
      canonicalReference: "ref-abc123",
      createdAtMs: NOW,
    };
    const result = await createPoll(
      afterDeadlineDeps(divergent),
      USER_1,
      afterDeadlineDraft(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Divergent — the route mints a fresh nonce so the edit publishes new;
      // deadlinePast copy about the live Poll would mislead.
      expect(result.error.code).toBe("poll_duplicate_divergent");
    }
  });

  it("falls back to the original validation error when the lookup throws", async () => {
    const result = await createPoll(
      {
        ...afterDeadlineDeps(null),
        findExistingPoll: async () => {
          throw new Error("D1_ERROR: connection lost");
        },
      },
      USER_1,
      afterDeadlineDraft(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reasonCodes).toEqual({ deadline: "deadline_past" });
    }
  });

  it("never consults the dedupe lookup for a draft without a nonce", async () => {
    const result = await createPoll(
      {
        persist: async () => {
          throw new Error("persist must not run");
        },
        generateId: () => "id-unused",
        generateReference: () => "ref-new",
        nowMs: () => LATER,
        findExistingPoll: async () => {
          throw new Error("lookup must not run without a nonce");
        },
      },
      USER_1,
      draft({ deadlineLocal: "2026-07-30T12:00", timeZone: "UTC" }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reasonCodes).toEqual({ deadline: "deadline_past" });
    }
  });
});
