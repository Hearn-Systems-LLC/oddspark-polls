import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createPollPersistence } from "../../src/adapters/d1/index";
import {
  DuplicatePollIdError,
  ReferenceTakenError,
  createPoll,
  type CreatePollDraft,
  type PollPersistenceRows,
} from "../../src/modules/polls/index";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_784_000_000_000;
const POLL_1 = "poll-1" as PollId;
const POLL_2 = "poll-2" as PollId;
const OWNER_1 = "owner-1" as UserId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  // Storage persists across tests in this file — reset poll data and keep
  // the owner insert idempotent. Clean all three tables explicitly rather
  // than trusting ON DELETE CASCADE (the cascade has its own schema test).
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('owner-1', 'Creator', 'owner-1@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).run();
});

function rows(overrides: Partial<PollPersistenceRows> = {}): PollPersistenceRows {
  return {
    poll: {
      id: POLL_1,
      ownerUserId: OWNER_1,
      pollType: "multiple_choice",
      question: "Where should we eat?",
      description: null,
      resultVisibility: "live",
      discoveryState: "unlisted",
      sessionChecksEnabled: true,
      ipChecksEnabled: false,
      voterCodesEnabled: false,
      captchaEnabled: false,
      vpnBlockingEnabled: false,
      multiSelectEnabled: false,
      minSelections: null,
      maxSelections: null,
      deadlineMs: null,
      representationVersion: 1,
      createdAtMs: NOW,
    },
    options: [
      { id: "opt-1" as PollOptionId, pollId: POLL_1, label: "Pizza", position: 0, createdAtMs: NOW },
      { id: "opt-2" as PollOptionId, pollId: POLL_1, label: "Tacos", position: 1, createdAtMs: NOW },
    ],
    reference: {
      reference: "ref-abc-123",
      pollId: POLL_1,
      kind: "generated",
      createdAtMs: NOW,
    },
    ...overrides,
  };
}

describe("createPollPersistence.insertPoll", () => {
  it("commits poll, options, and reference in one batch", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(rows());

    const poll = await testEnv.DB.prepare(
      "SELECT owner_user_id, poll_type, result_visibility, discovery_state, session_checks_enabled, multi_select_enabled, min_selections, max_selections, representation_version, deadline_ms, closed_at_ms FROM poll WHERE id = 'poll-1'",
    ).first();
    expect(poll).toEqual({
      owner_user_id: "owner-1",
      poll_type: "multiple_choice",
      result_visibility: "live",
      discovery_state: "unlisted",
      session_checks_enabled: 1,
      multi_select_enabled: 0,
      min_selections: null,
      max_selections: null,
      representation_version: 1,
      deadline_ms: null,
      closed_at_ms: null,
    });

    const optionCount = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM poll_option WHERE poll_id = 'poll-1'",
    ).first<{ n: number }>();
    expect(optionCount?.n).toBe(2);
  });

  it("round-trips explicit multi-select bounds through every poll read", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    const multiSelect = rows();
    multiSelect.poll = {
      ...multiSelect.poll,
      multiSelectEnabled: true,
      minSelections: 2,
      maxSelections: 2,
    };
    await persistence.insertPoll(multiSelect);

    const expectedBounds = {
      multiSelectEnabled: true,
      minSelections: 2,
      maxSelections: 2,
    };
    await expect(
      persistence.findPollByReference("ref-abc-123"),
    ).resolves.toMatchObject(expectedBounds);
    await expect(
      persistence.findPollForOwner(POLL_1, OWNER_1),
    ).resolves.toMatchObject(expectedBounds);
  });

  it("persists a custom reference as the one canonical row", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      rows({
        reference: {
          reference: "team-lunch",
          pollId: POLL_1,
          kind: "custom",
          createdAtMs: NOW,
        },
      }),
    );

    const references = await testEnv.DB.prepare(
      "SELECT reference, kind, is_canonical FROM poll_reference WHERE poll_id = ?1",
    )
      .bind(POLL_1)
      .all();
    expect(references.results).toEqual([
      { reference: "team-lunch", kind: "custom", is_canonical: 1 },
    ]);
  });

  it("leaves no reachable Poll when any statement in the batch fails", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(rows());

    // Same reference, different poll — the reference insert violates its
    // primary key, and the whole second batch must roll back.
    const conflicting = rows();
    conflicting.poll = { ...conflicting.poll, id: POLL_2 };
    conflicting.options = conflicting.options.map((option, index) => ({
      ...option,
      id: `opt-conflict-${index}` as PollOptionId,
      pollId: POLL_2,
    }));
    conflicting.reference = { ...conflicting.reference, pollId: POLL_2 };

    await expect(persistence.insertPoll(conflicting)).rejects.toBeInstanceOf(
      ReferenceTakenError,
    );

    const polls = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM poll",
    ).first<{ n: number }>();
    const options = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM poll_option",
    ).first<{ n: number }>();
    expect(polls?.n).toBe(1);
    expect(options?.n).toBe(2);
  });

  it("translates a poll PRIMARY KEY collision into DuplicatePollIdError (D4)", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(rows());

    // Same poll ID, distinct option/reference rows — the batch fails on the
    // poll PRIMARY KEY, the one collision the domain has dedupe policy for.
    const conflicting = rows();
    conflicting.options = conflicting.options.map((option, index) => ({
      ...option,
      id: `opt-dupe-${index}` as PollOptionId,
    }));
    conflicting.reference = { ...conflicting.reference, reference: "ref-dupe" };

    await expect(persistence.insertPoll(conflicting)).rejects.toBeInstanceOf(
      DuplicatePollIdError,
    );
  });

  it("keeps duplicate poll-ID precedence when the reference also collides", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(rows());

    const conflicting = rows();
    conflicting.options = conflicting.options.map((option, index) => ({
      ...option,
      id: `opt-both-${index}` as PollOptionId,
    }));

    await expect(persistence.insertPoll(conflicting)).rejects.toBeInstanceOf(
      DuplicatePollIdError,
    );
  });
});

describe("createPollPersistence reads", () => {
  it("rejects a duplicate-ID retry whose only divergence is multi-select bounds", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    const nonce = "3f6b2c90-9a42-4d8e-b7a1-2c4e5f6a7b8c";
    let generatedId = 0;
    const deps = {
      persist: persistence.insertPoll,
      findExistingPoll: persistence.findPollForOwner,
      generateId: () => `d4-option-${(generatedId += 1)}`,
      generateReference: () => "d4-bounds-reference",
      nowMs: () => NOW,
    };
    const draft: CreatePollDraft = {
      idempotencyId: nonce,
      question: "Where should we eat?",
      description: "",
      options: ["Pizza", "Tacos"],
      resultVisibility: "live",
      deadlineLocal: "",
      timeZone: "",
      customLink: "",
      multiSelect: "true",
      minSelections: "1",
      maxSelections: "2",
      sessionChecks: "true",
      ipChecks: "false",
      voterCodes: "false",
      captcha: "false",
      vpnBlocking: "false",
    };

    await expect(createPoll(deps, OWNER_1, draft)).resolves.toMatchObject({
      ok: true,
      value: { existing: false, pollId: nonce },
    });
    await expect(
      createPoll(deps, OWNER_1, {
        ...draft,
        minSelections: "2",
        maxSelections: "2",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "poll_duplicate_divergent" },
    });
    await expect(
      createPoll(deps, OWNER_1, {
        ...draft,
        minSelections: "1",
        maxSelections: "1",
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "poll_duplicate_divergent" },
    });
    await expect(
      persistence.findPollForOwner(nonce as PollId, OWNER_1),
    ).resolves.toMatchObject({
      multiSelectEnabled: true,
      minSelections: 1,
      maxSelections: 2,
    });
  });

  it("finds a poll page by reference with ordered options", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      rows({
        reference: {
          reference: "team-lunch",
          pollId: POLL_1,
          kind: "custom",
          createdAtMs: NOW,
        },
      }),
    );

    const page = await persistence.findPollByReference("team-lunch");
    expect(page).toEqual({
      pollId: "poll-1",
      canonicalReference: "team-lunch",
      question: "Where should we eat?",
      description: null,
      pollType: "multiple_choice",
      resultVisibility: "live",
      multiSelectEnabled: false,
      minSelections: null,
      maxSelections: null,
      sessionChecksEnabled: true,
      ipChecksEnabled: false,
      voterCodesEnabled: false,
      captchaEnabled: false,
      vpnBlockingEnabled: false,
      deadlineMs: null,
      closedAtMs: null,
      options: [
        { id: "opt-1", label: "Pizza", position: 0 },
        { id: "opt-2", label: "Tacos", position: 1 },
      ],
    });
  });

  it("resolves an exact alias while returning the canonical reference for sharing", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      rows({
        reference: {
          reference: "team-lunch",
          pollId: POLL_1,
          kind: "custom",
          createdAtMs: NOW,
        },
      }),
    );
    await testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('old-lunch', ?1, 'custom', 0, ?2)",
    )
      .bind(POLL_1, NOW)
      .run();

    await expect(
      persistence.findPollByReference("old-lunch"),
    ).resolves.toMatchObject({
      pollId: POLL_1,
      question: "Where should we eat?",
      canonicalReference: "team-lunch",
    });
  });

  it("returns null for an unknown reference", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    expect(await persistence.findPollByReference("nope")).toBeNull();
  });

  it("finds a poll for its owner only", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      rows({
        reference: {
          reference: "team-lunch",
          pollId: POLL_1,
          kind: "custom",
          createdAtMs: NOW,
        },
      }),
    );

    const owned = await persistence.findPollForOwner(POLL_1, OWNER_1);
    expect(owned).toMatchObject({
      pollId: "poll-1",
      question: "Where should we eat?",
      canonicalReference: "team-lunch",
      canonicalReferenceKind: "custom",
      createdAtMs: NOW,
    });

    expect(
      await persistence.findPollForOwner(POLL_1, "someone-else" as UserId),
    ).toBeNull();
  });
});

describe("createPollPersistence.findCanonicalCustomReference", () => {
  it("resolves a case variant of a custom reference to its canonical form", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      rows({
        reference: {
          reference: "team-lunch",
          pollId: POLL_1,
          kind: "custom",
          createdAtMs: NOW,
        },
      }),
    );

    expect(
      await persistence.findCanonicalCustomReference("TEAM-Lunch"),
    ).toBe("team-lunch");
    expect(await persistence.findCanonicalCustomReference("team-lunch")).toBe(
      "team-lunch",
    );
  });

  it("never case-folds a generated reference", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      rows({
        reference: {
          reference: "aB3-xY_9qWmZvK2pL0dEfG",
          pollId: POLL_1,
          kind: "generated",
          createdAtMs: NOW,
        },
      }),
    );

    expect(
      await persistence.findCanonicalCustomReference(
        "ab3-xy_9qwmzvk2pl0defg",
      ),
    ).toBeNull();
  });

  it("ignores non-canonical custom rows", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      rows({
        reference: {
          reference: "team-lunch",
          pollId: POLL_1,
          kind: "custom",
          createdAtMs: NOW,
        },
      }),
    );
    await testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('old-lunch', ?1, 'custom', 0, ?2)",
    )
      .bind(POLL_1, NOW)
      .run();

    expect(
      await persistence.findCanonicalCustomReference("OLD-Lunch"),
    ).toBeNull();
    expect(await persistence.findCanonicalCustomReference("TEAM-Lunch")).toBe(
      "team-lunch",
    );
  });

  it("returns null for an unknown reference", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    expect(
      await persistence.findCanonicalCustomReference("nope"),
    ).toBeNull();
  });

  it("skips an out-of-band charset-violating row instead of selecting it", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(
      rows({
        reference: {
          reference: "team-lunch",
          pollId: POLL_1,
          kind: "custom",
          createdAtMs: NOW,
        },
      }),
    );
    // Out-of-band write the app would never make: a BINARY primary key
    // physically permits a mixed-case canonical row on another poll — with
    // the uppercase byte AFTER position 0, so only a true full-charset
    // filter excludes it (a first-character filter would not).
    const outOfBand = rows();
    outOfBand.poll = { ...outOfBand.poll, id: POLL_2 };
    outOfBand.options = outOfBand.options.map((option, index) => ({
      ...option,
      id: `opt-upper-${index}` as PollOptionId,
      pollId: POLL_2,
    }));
    outOfBand.reference = {
      reference: "tEAM-lunch",
      pollId: POLL_2,
      kind: "custom",
      createdAtMs: NOW,
    };
    await persistence.insertPoll(outOfBand);

    expect(await persistence.findCanonicalCustomReference("TEAM-LUNCH")).toBe(
      "team-lunch",
    );
  });
});
