import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createPollPersistence } from "../../src/adapters/d1/index";
import {
  DuplicatePollIdError,
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
      "SELECT owner_user_id, poll_type, result_visibility, discovery_state, session_checks_enabled, representation_version, deadline_ms, closed_at_ms FROM poll WHERE id = 'poll-1'",
    ).first();
    expect(poll).toEqual({
      owner_user_id: "owner-1",
      poll_type: "multiple_choice",
      result_visibility: "live",
      discovery_state: "unlisted",
      session_checks_enabled: 1,
      representation_version: 1,
      deadline_ms: null,
      closed_at_ms: null,
    });

    const optionCount = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM poll_option WHERE poll_id = 'poll-1'",
    ).first<{ n: number }>();
    expect(optionCount?.n).toBe(2);
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

    await expect(persistence.insertPoll(conflicting)).rejects.toThrow();

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
});

describe("createPollPersistence reads", () => {
  it("finds a poll page by reference with ordered options", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(rows());

    const page = await persistence.findPollByReference("ref-abc-123");
    expect(page).toEqual({
      pollId: "poll-1",
      question: "Where should we eat?",
      description: null,
      pollType: "multiple_choice",
      resultVisibility: "live",
      deadlineMs: null,
      closedAtMs: null,
      options: [
        { id: "opt-1", label: "Pizza", position: 0 },
        { id: "opt-2", label: "Tacos", position: 1 },
      ],
    });
  });

  it("returns null for an unknown reference", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    expect(await persistence.findPollByReference("nope")).toBeNull();
  });

  it("finds a poll for its owner only", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(rows());

    const owned = await persistence.findPollForOwner(POLL_1, OWNER_1);
    expect(owned).toMatchObject({
      pollId: "poll-1",
      question: "Where should we eat?",
      canonicalReference: "ref-abc-123",
      createdAtMs: NOW,
    });

    expect(
      await persistence.findPollForOwner(POLL_1, "someone-else" as UserId),
    ).toBeNull();
  });
});
