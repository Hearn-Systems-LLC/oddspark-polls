import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createResultsPersistence } from "../../src/adapters/d1/index";
import type { PollId } from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_800_000_000_000;
const POLL_ID = "meeting-results-poll" as PollId;
const OWNER_ID = "meeting-results-owner";

const SLOTS = [
  {
    id: "meeting-results-slot-a",
    startsAtMs: NOW + 3_600_000,
    endsAtMs: NOW + 5_400_000,
    timeZone: "America/Detroit",
    position: 0,
  },
  {
    id: "meeting-results-slot-b",
    startsAtMs: NOW + 86_400_000,
    endsAtMs: NOW + 90_000_000,
    timeZone: "UTC",
    position: 1,
  },
  {
    id: "meeting-results-slot-c",
    startsAtMs: NOW + 172_800_000,
    endsAtMs: NOW + 176_400_000,
    timeZone: "Europe/Berlin",
    position: 2,
  },
] as const;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM meeting_availability").run();
  await testEnv.DB.prepare("DELETE FROM meeting_response").run();
  await testEnv.DB.prepare("DELETE FROM meeting_slot").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Creator', 'meeting-results@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  )
    .bind(OWNER_ID)
    .run();
});

async function seedMeeting(
  overrides: {
    pollId?: PollId;
    pollType?: "meeting" | "multiple_choice";
    representationVersion?: number;
    deadlineMs?: number | null;
    closedAtMs?: number | null;
  } = {},
): Promise<PollId> {
  const pollId = overrides.pollId ?? POLL_ID;
  const pollType = overrides.pollType ?? "meeting";
  await testEnv.DB.prepare(
    `INSERT INTO poll (
       id, owner_user_id, poll_type, question, result_visibility,
       session_checks_enabled, multi_select_enabled, min_selections,
       max_selections, deadline_ms, closed_at_ms, representation_version,
       created_at_ms, updated_at_ms
     ) VALUES (?1, ?2, ?3, 'When can everyone meet?', 'live',
       0, 0, NULL, NULL, ?4, ?5, ?6, ?7, ?7)`,
  )
    .bind(
      pollId,
      OWNER_ID,
      pollType,
      overrides.deadlineMs ?? NOW + 604_800_000,
      overrides.closedAtMs ?? null,
      overrides.representationVersion ?? 7,
      NOW,
    )
    .run();

  if (pollType === "meeting") {
    // Deliberately insert out of order; outward slot order is `position`.
    for (const slot of [SLOTS[2], SLOTS[0], SLOTS[1]]) {
      await testEnv.DB.prepare(
        `INSERT INTO meeting_slot (
           id, poll_id, position, starts_at_ms, ends_at_ms, time_zone,
           created_at_ms
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
      )
        .bind(
          slot.id,
          pollId,
          slot.position,
          slot.startsAtMs,
          slot.endsAtMs,
          slot.timeZone,
          NOW,
        )
        .run();
    }
  }
  return pollId;
}

async function insertResponse(input: {
  voteId: string;
  displayName: string;
  createdAtMs: number;
  availability: readonly {
    slotId: string;
    state: "yes" | "if_need_be" | "no";
  }[];
}): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(
      input.voteId,
      POLL_ID,
      `submission-${input.voteId}`,
      `hash-${input.voteId}`,
      input.createdAtMs,
    ),
    testEnv.DB.prepare(
      "INSERT INTO meeting_response (vote_id, display_name, revision_capability_digest) VALUES (?1, ?2, ?3)",
    ).bind(input.voteId, input.displayName, `digest-${input.voteId}`),
    ...input.availability.map(({ slotId, state }) =>
      testEnv.DB.prepare(
        "INSERT INTO meeting_availability (vote_id, meeting_slot_id, availability) VALUES (?1, ?2, ?3)",
      ).bind(input.voteId, slotId, state),
    ),
  ]);
}

describe("Meeting Results D1 projection", () => {
  it("projects positioned slots and zero totals without inventing response rows", async () => {
    await seedMeeting();

    const projection = await createResultsPersistence(
      testEnv.DB,
    ).projectMeetingResults(POLL_ID, NOW);

    expect(projection).toEqual({
      representationVersion: 7,
      effectiveStatus: "open",
      slots: SLOTS.map(({ id: _id, ...slot }) => ({
        ...slot,
        yesCount: 0,
        ifNeedBeCount: 0,
        noCount: 0,
      })),
      voters: [],
    });
    expect(JSON.stringify(projection)).not.toContain("meeting-results-slot-");
  });

  it("orders responses deterministically, preserves unanswered cells, and totals each state", async () => {
    await seedMeeting();
    await insertResponse({
      voteId: "vote-b",
      displayName: "Beta",
      createdAtMs: NOW + 1,
      availability: [
        { slotId: SLOTS[0].id, state: "if_need_be" },
        { slotId: SLOTS[1].id, state: "yes" },
      ],
    });
    await insertResponse({
      voteId: "vote-a",
      displayName: "<Alex & Co>",
      createdAtMs: NOW + 1,
      availability: [
        { slotId: SLOTS[0].id, state: "yes" },
        { slotId: SLOTS[2].id, state: "no" },
      ],
    });
    await insertResponse({
      voteId: "vote-late",
      displayName: "Later",
      createdAtMs: NOW + 2,
      availability: [
        { slotId: SLOTS[0].id, state: "no" },
        { slotId: SLOTS[1].id, state: "if_need_be" },
        { slotId: SLOTS[2].id, state: "yes" },
      ],
    });

    const projection = await createResultsPersistence(
      testEnv.DB,
    ).projectMeetingResults(POLL_ID, NOW);

    expect(projection?.voters).toEqual([
      {
        displayName: "<Alex & Co>",
        availability: ["yes", null, "no"],
      },
      {
        displayName: "Beta",
        availability: ["if_need_be", "yes", null],
      },
      {
        displayName: "Later",
        availability: ["no", "if_need_be", "yes"],
      },
    ]);
    expect(
      projection?.slots.map(
        ({ yesCount, ifNeedBeCount, noCount }) => ({
          yesCount,
          ifNeedBeCount,
          noCount,
        }),
      ),
    ).toEqual([
      { yesCount: 1, ifNeedBeCount: 1, noCount: 1 },
      { yesCount: 1, ifNeedBeCount: 1, noCount: 0 },
      { yesCount: 1, ifNeedBeCount: 0, noCount: 1 },
    ]);
    expect(JSON.stringify(projection)).not.toMatch(/vote-[abl]/);
    expect(JSON.stringify(projection)).not.toContain("meeting-results-slot-");
  });

  it("carries the same-snapshot representation version and effective closed state", async () => {
    await seedMeeting({
      representationVersion: 11,
      deadlineMs: NOW,
    });

    await expect(
      createResultsPersistence(testEnv.DB).projectMeetingResults(
        POLL_ID,
        NOW,
      ),
    ).resolves.toMatchObject({
      representationVersion: 11,
      effectiveStatus: "closed",
    });
  });

  it("returns null for a missing Poll and rejects a non-Meeting Poll", async () => {
    const persistence = createResultsPersistence(testEnv.DB);
    await expect(
      persistence.projectMeetingResults("missing-meeting" as PollId, NOW),
    ).resolves.toBeNull();

    await seedMeeting({ pollType: "multiple_choice" });
    await expect(
      persistence.projectMeetingResults(POLL_ID, NOW),
    ).rejects.toThrow(/non-Meeting Poll/);
  });

  it("fails closed when an accepted Meeting Vote has no attributed response", async () => {
    await seedMeeting();
    await testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('orphan-vote', ?1, 'orphan-submission', 'orphan-hash', ?2)",
    )
      .bind(POLL_ID, NOW)
      .run();

    await expect(
      createResultsPersistence(testEnv.DB).projectMeetingResults(POLL_ID, NOW),
    ).rejects.toThrow(/Vote rows without responses/);
  });
});
