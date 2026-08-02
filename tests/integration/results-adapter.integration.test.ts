import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createResultsPersistence } from "../../src/adapters/d1/index";
import type { PollId, PollOptionId } from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_800_000_000_000;
const POLL_ID = "results-it-poll" as PollId;
const OTHER_POLL_ID = "results-it-other-poll" as PollId;
const OPTION_A = "results-it-option-a" as PollOptionId;
const OPTION_B = "results-it-option-b" as PollOptionId;
const OPTION_C = "results-it-option-c" as PollOptionId;
const OTHER_OPTION = "results-it-other-option" as PollOptionId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('results-it-owner', 'Creator', 'results-it-owner@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).run();
});

async function insertPoll(
  overrides: {
    pollId?: PollId;
    reference?: string;
    resultVisibility?: "live" | "after_close" | "creator_only";
    multiSelectEnabled?: boolean;
    deadlineMs?: number | null;
    closedAtMs?: number | null;
    // Insertion order deliberately shuffled: the projection must order by
    // position, not by rowid or id.
    options?: { id: PollOptionId; label: string; position: number }[];
  } = {},
): Promise<PollId> {
  const pollId = overrides.pollId ?? POLL_ID;
  const reference = overrides.reference ?? "results-it-link";
  const options = overrides.options ?? [
    { id: OPTION_B, label: "Beta", position: 1 },
    { id: OPTION_A, label: "Alpha", position: 0 },
    { id: OPTION_C, label: "Gamma", position: 2 },
  ];
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, session_checks_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, closed_at_ms, representation_version, created_at_ms, updated_at_ms) VALUES (?1, 'results-it-owner', 'multiple_choice', 'Choose results', ?2, 1, ?3, NULL, NULL, ?4, ?5, 1, 0, 0)",
    ).bind(
      pollId,
      overrides.resultVisibility ?? "live",
      overrides.multiSelectEnabled === true ? 1 : 0,
      overrides.deadlineMs ?? null,
      overrides.closedAtMs ?? null,
    ),
    ...options.map((option) =>
      testEnv.DB.prepare(
        "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, ?3, ?4, 0)",
      ).bind(option.id, pollId, option.label, option.position),
    ),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'generated', 1, 0)",
    ).bind(reference, pollId),
  ]);
  return pollId;
}

async function insertVote(
  voteId: string,
  pollId: PollId,
  selectedOptionIds: PollOptionId[],
): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(voteId, pollId, `submission-${voteId}`, `hash-${voteId}`, NOW),
    ...selectedOptionIds.map((optionId) =>
      testEnv.DB.prepare(
        "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
      ).bind(voteId, optionId),
    ),
  ]);
}

describe("createResultsPersistence access read", () => {
  it("resolves the safe access envelope by canonical reference with no result-shape fields", async () => {
    await insertPoll({
      resultVisibility: "after_close",
      multiSelectEnabled: true,
      deadlineMs: NOW + 60_000,
    });
    await insertVote("vote-1", POLL_ID, [OPTION_A, OPTION_B]);
    const persistence = createResultsPersistence(testEnv.DB);

    // Exact key set: the envelope may carry only entitlement/hidden-shape
    // facts — never options, counts, percentages, or representationVersion.
    expect(await persistence.findAccessEnvelope("results-it-link")).toEqual({
      pollId: POLL_ID,
      question: "Choose results",
      resultVisibility: "after_close",
      ownerUserId: "results-it-owner",
      deadlineMs: NOW + 60_000,
      closedAtMs: null,
      multiSelectEnabled: true,
      canonicalReference: "results-it-link",
    });
  });

  it("resolves an exact alias while returning the Poll's canonical reference", async () => {
    await insertPoll();
    await testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('results-it-alias', ?1, 'custom', 0, 0)",
    )
      .bind(POLL_ID)
      .run();
    const persistence = createResultsPersistence(testEnv.DB);

    await expect(
      persistence.findAccessEnvelope("results-it-alias"),
    ).resolves.toMatchObject({
      pollId: POLL_ID,
      canonicalReference: "results-it-link",
    });
  });

  it("returns null for a missing or deleted reference", async () => {
    await insertPoll();
    const persistence = createResultsPersistence(testEnv.DB);
    await testEnv.DB.prepare("DELETE FROM poll WHERE id = ?1")
      .bind(POLL_ID)
      .run();

    await expect(
      persistence.findAccessEnvelope("results-it-link"),
    ).resolves.toBeNull();
    await expect(
      persistence.findAccessEnvelope("never-existed"),
    ).resolves.toBeNull();
  });
});

describe("createResultsPersistence tally projection", () => {
  it("keeps every option at zero on its baseline when the Poll has no Votes", async () => {
    await insertPoll();
    const persistence = createResultsPersistence(testEnv.DB);

    await expect(persistence.projectTally(POLL_ID)).resolves.toEqual({
      options: [
        { id: OPTION_A, label: "Alpha", position: 0, count: 0 },
        { id: OPTION_B, label: "Beta", position: 1, count: 0 },
        { id: OPTION_C, label: "Gamma", position: 2, count: 0 },
      ],
      voterCount: 0,
      selectionCount: 0,
    });
  });

  it("counts single-select Votes per option in stable position order", async () => {
    await insertPoll();
    await insertVote("vote-1", POLL_ID, [OPTION_A]);
    await insertVote("vote-2", POLL_ID, [OPTION_A]);
    await insertVote("vote-3", POLL_ID, [OPTION_B]);
    const persistence = createResultsPersistence(testEnv.DB);

    const projection = await persistence.projectTally(POLL_ID);
    expect(projection.options).toEqual([
      { id: OPTION_A, label: "Alpha", position: 0, count: 2 },
      { id: OPTION_B, label: "Beta", position: 1, count: 1 },
      // An option with zero selections survives the left join.
      { id: OPTION_C, label: "Gamma", position: 2, count: 0 },
    ]);
    expect(projection.voterCount).toBe(3);
    expect(projection.selectionCount).toBe(3);
  });

  it("reports multi-select Voters and selections as separate totals", async () => {
    await insertPoll({ multiSelectEnabled: true });
    await insertVote("vote-1", POLL_ID, [OPTION_A, OPTION_B]);
    await insertVote("vote-2", POLL_ID, [OPTION_A, OPTION_C]);
    const persistence = createResultsPersistence(testEnv.DB);

    const projection = await persistence.projectTally(POLL_ID);
    expect(projection.options.map(({ count }) => count)).toEqual([2, 1, 1]);
    expect(projection.voterCount).toBe(2);
    expect(projection.selectionCount).toBe(4);
  });

  it("keeps a multi-select Poll's zero-Vote shape intact", async () => {
    await insertPoll({ multiSelectEnabled: true });
    const persistence = createResultsPersistence(testEnv.DB);

    const projection = await persistence.projectTally(POLL_ID);
    expect(projection.options).toHaveLength(3);
    expect(projection.options.every(({ count }) => count === 0)).toBe(true);
    expect(projection.voterCount).toBe(0);
    expect(projection.selectionCount).toBe(0);
  });

  it("keeps Voter and selection totals equal when every Voter picked exactly one option", async () => {
    await insertPoll({ multiSelectEnabled: true });
    await insertVote("vote-1", POLL_ID, [OPTION_A]);
    await insertVote("vote-2", POLL_ID, [OPTION_C]);
    const persistence = createResultsPersistence(testEnv.DB);

    const projection = await persistence.projectTally(POLL_ID);
    expect(projection.voterCount).toBe(2);
    expect(projection.selectionCount).toBe(2);
  });

  it("returns an exact tie as equal counts without inventing a leader", async () => {
    await insertPoll();
    await insertVote("vote-1", POLL_ID, [OPTION_A]);
    await insertVote("vote-2", POLL_ID, [OPTION_B]);
    const persistence = createResultsPersistence(testEnv.DB);

    const projection = await persistence.projectTally(POLL_ID);
    expect(projection.options.map(({ count }) => count)).toEqual([1, 1, 0]);
  });

  it("never leaks a cross-Poll selection and fails closed on its malformed source Vote", async () => {
    await insertPoll();
    await insertPoll({
      pollId: OTHER_POLL_ID,
      reference: "results-it-other-link",
      options: [{ id: OTHER_OPTION, label: "Other", position: 0 }],
    });
    // Independently valid FKs: the Vote is Poll B's, the option is Poll A's.
    await insertVote("vote-cross", OTHER_POLL_ID, [OPTION_A]);
    const persistence = createResultsPersistence(testEnv.DB);

    const victim = await persistence.projectTally(POLL_ID);
    expect(victim.options.map(({ count }) => count)).toEqual([0, 0, 0]);
    expect(victim.voterCount).toBe(0);
    expect(victim.selectionCount).toBe(0);

    // The source Poll owns the Vote but not its only selection. Excluding the
    // cross-Poll row leaves an accepted Vote with no valid selection, which
    // must fail closed rather than render "No Votes yet" beside 1 Voter.
    await expect(
      persistence.projectTally(OTHER_POLL_ID),
    ).rejects.toThrow(/fewer selections than Voters/);
  });

  it("projects an empty tally for a missing Poll id", async () => {
    const persistence = createResultsPersistence(testEnv.DB);
    await expect(
      persistence.projectTally("results-it-missing" as PollId),
    ).resolves.toEqual({ options: [], voterCount: 0, selectionCount: 0 });
  });

  it("fails closed when a resolved Poll has accepted Votes but no options", async () => {
    await insertPoll({ options: [] });
    await insertVote("vote-without-options", POLL_ID, []);
    const persistence = createResultsPersistence(testEnv.DB);

    await expect(persistence.projectTally(POLL_ID)).rejects.toThrow(
      /resolved Poll has no options/,
    );
  });
});
