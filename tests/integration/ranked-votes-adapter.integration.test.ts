import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createVotePersistence } from "../../src/adapters/d1/index";
import { PollDefinitionChangedError } from "../../src/modules/voting/index";
import { incrementRepresentationVersion } from "../../src/shared/application/index";
import type {
  PollId,
  PollOptionId,
} from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_800_000_000_000;
const POLL_ID = "ranked-adapter-poll" as PollId;
const OTHER_POLL_ID = "ranked-adapter-other" as PollId;
const OPTION_A = "ranked-adapter-a" as PollOptionId;
const OPTION_B = "ranked-adapter-b" as PollOptionId;
const OTHER_OPTION = "ranked-adapter-other-a" as PollOptionId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote_comment").run();
  await testEnv.DB.prepare("DELETE FROM ranked_vote_preference").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('ranked-adapter-owner', 'Creator', 'ranked-adapter-owner@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).run();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, session_checks_enabled, multi_select_enabled, min_selections, max_selections, representation_version, created_at_ms, updated_at_ms) VALUES (?1, 'ranked-adapter-owner', 'ranked_choice', 'Rank these', 'live', 0, 0, NULL, NULL, 1, 0, 0)",
    ).bind(POLL_ID),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'A', 0, 0)",
    ).bind(OPTION_A, POLL_ID),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'B', 1, 0)",
    ).bind(OPTION_B, POLL_ID),
    testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, session_checks_enabled, representation_version, created_at_ms, updated_at_ms) VALUES (?1, 'ranked-adapter-owner', 'multiple_choice', 'Other', 'live', 0, 1, 0, 0)",
    ).bind(OTHER_POLL_ID),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Other A', 0, 0)",
    ).bind(OTHER_OPTION, OTHER_POLL_ID),
  ]);
});

function rankedBatch(
  preferences: { pollOptionId: PollOptionId; rank: number }[] = [
    { pollOptionId: OPTION_A, rank: 2 },
    { pollOptionId: OPTION_B, rank: 1 },
  ],
) {
  return {
    vote: {
      id: "ranked-adapter-vote",
      pollId: POLL_ID,
      submissionId: "ranked-adapter-submission",
      payloadHash: "ranked-adapter-payload",
      createdAtMs: NOW,
    },
    contributions: preferences.map(({ pollOptionId, rank }) => ({
      kind: "ranked_preference" as const,
      voteId: "ranked-adapter-vote",
      pollOptionId,
      rank,
    })),
    representationVersion: incrementRepresentationVersion(POLL_ID, NOW),
  };
}

async function counts() {
  const [votes, preferences, selections, version] = await Promise.all([
    testEnv.DB.prepare("SELECT COUNT(*) AS count FROM vote").first<{
      count: number;
    }>(),
    testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM ranked_vote_preference",
    ).first<{ count: number }>(),
    testEnv.DB.prepare("SELECT COUNT(*) AS count FROM vote_selection").first<{
      count: number;
    }>(),
    testEnv.DB.prepare(
      "SELECT representation_version FROM poll WHERE id = ?1",
    )
      .bind(POLL_ID)
      .first<{ representation_version: number }>(),
  ]);
  return {
    votes: votes?.count,
    preferences: preferences?.count,
    selections: selections?.count,
    version: version?.representation_version,
  };
}

describe("Ranked Vote D1 persistence", () => {
  it("commits the Vote, exact preference order, and representation increment atomically", async () => {
    await createVotePersistence(testEnv.DB).insertVote(rankedBatch());

    await expect(counts()).resolves.toEqual({
      votes: 1,
      preferences: 2,
      selections: 0,
      version: 2,
    });
    await expect(
      testEnv.DB.prepare(
        "SELECT poll_option_id, preference_rank FROM ranked_vote_preference ORDER BY preference_rank",
      ).all(),
    ).resolves.toMatchObject({
      results: [
        { poll_option_id: OPTION_B, preference_rank: 1 },
        { poll_option_id: OPTION_A, preference_rank: 2 },
      ],
    });
  });

  it("rejects duplicate, skipped, and mixed fact families before D1 writes", async () => {
    const persistence = createVotePersistence(testEnv.DB);
    await expect(
      persistence.insertVote(
        rankedBatch([
          { pollOptionId: OPTION_A, rank: 1 },
          { pollOptionId: OPTION_A, rank: 2 },
        ]),
      ),
    ).rejects.toThrow(/invalid ranked preference contribution/);
    await expect(
      persistence.insertVote(
        rankedBatch([{ pollOptionId: OPTION_A, rank: 2 }]),
      ),
    ).rejects.toThrow(/invalid vote persistence batch/);
    const mixed = rankedBatch([{ pollOptionId: OPTION_A, rank: 1 }]);
    await expect(
      persistence.insertVote({
        ...mixed,
        contributions: [
          ...mixed.contributions,
          {
            kind: "vote_selection",
            voteId: mixed.vote.id,
            pollOptionId: OPTION_B,
          },
        ],
      }),
    ).rejects.toThrow(/invalid vote persistence batch/);
    await expect(counts()).resolves.toEqual({
      votes: 0,
      preferences: 0,
      selections: 0,
      version: 1,
    });
  });

  it("rolls back every shared fact when an option belongs to another Poll", async () => {
    await expect(
      createVotePersistence(testEnv.DB).insertVote(
        rankedBatch([{ pollOptionId: OTHER_OPTION, rank: 1 }]),
      ),
    ).rejects.toBeInstanceOf(PollDefinitionChangedError);
    await expect(counts()).resolves.toEqual({
      votes: 0,
      preferences: 0,
      selections: 0,
      version: 1,
    });
  });

  it("enforces Ranked Poll bounds and contiguous preferences for direct SQL writers", async () => {
    await expect(
      testEnv.DB.prepare(
        "UPDATE poll SET multi_select_enabled = 1 WHERE id = ?1",
      )
        .bind(POLL_ID)
        .run(),
    ).rejects.toThrow(/ranked_poll_bounds_invalid/);

    await testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES ('direct-ranked-vote', ?1, 'direct-submission', 'direct-hash', ?2)",
    )
      .bind(POLL_ID, NOW)
      .run();
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO ranked_vote_preference (vote_id, poll_option_id, preference_rank) VALUES ('direct-ranked-vote', ?1, 2)",
      )
        .bind(OPTION_A)
        .run(),
    ).rejects.toThrow(/ranked_preference_rank_invalid/);
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES ('direct-ranked-vote', ?1)",
      )
        .bind(OPTION_A)
        .run(),
    ).rejects.toThrow(/ranked_preference_required/);
  });
});
