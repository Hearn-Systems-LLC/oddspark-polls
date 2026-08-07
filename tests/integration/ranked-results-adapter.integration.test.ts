import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createResultsPersistence } from "../../src/adapters/d1/index";
import {
  queryLiveResults,
  queryResults,
} from "../../src/modules/results/index";
import type {
  PollId,
  PollOptionId,
} from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_800_000_000_000;
const POLL_ID = "ranked-results-poll" as PollId;
const OPTION_A = "ranked-results-a" as PollOptionId;
const OPTION_B = "ranked-results-b" as PollOptionId;
const OPTION_C = "ranked-results-c" as PollOptionId;
const OWNER = "ranked-results-owner";

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM ranked_vote_preference").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Creator', 'ranked-results-owner@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  )
    .bind(OWNER)
    .run();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO poll (
         id, owner_user_id, poll_type, question, result_visibility,
         session_checks_enabled, multi_select_enabled, min_selections, max_selections,
         representation_version, created_at_ms, updated_at_ms
       ) VALUES (?1, ?2, 'ranked_choice', 'Rank lunch', 'live', 0, 0, NULL, NULL, 3, 0, 0)`,
    ).bind(POLL_ID, OWNER),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (poll_id, reference, kind, is_canonical, created_at_ms) VALUES (?1, 'rank-lunch', 'custom', 1, 0)",
    ).bind(POLL_ID),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Pizza', 0, 0)",
    ).bind(OPTION_A, POLL_ID),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Sushi', 1, 0)",
    ).bind(OPTION_B, POLL_ID),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Tacos', 2, 0)",
    ).bind(OPTION_C, POLL_ID),
  ]);
});

async function insertBallot(
  voteId: string,
  preferences: { optionId: PollOptionId; rank: number }[],
): Promise<void> {
  const statements = [
    testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(voteId, POLL_ID, `sub-${voteId}`, `hash-${voteId}`, NOW),
  ];
  for (const preference of preferences) {
    statements.push(
      testEnv.DB.prepare(
        "INSERT INTO ranked_vote_preference (vote_id, poll_option_id, preference_rank) VALUES (?1, ?2, ?3)",
      ).bind(voteId, preference.optionId, preference.rank),
    );
  }
  await testEnv.DB.batch(statements);
}

describe("Ranked Results D1 projection", () => {
  it("tabulates ballots into a versioned ranked projection", async () => {
    // A majority: 3 pizza first-choice of 4 ballots.
    await insertBallot("v1", [
      { optionId: OPTION_A, rank: 1 },
      { optionId: OPTION_B, rank: 2 },
    ]);
    await insertBallot("v2", [
      { optionId: OPTION_A, rank: 1 },
      { optionId: OPTION_C, rank: 2 },
    ]);
    await insertBallot("v3", [
      { optionId: OPTION_A, rank: 1 },
    ]);
    await insertBallot("v4", [
      { optionId: OPTION_B, rank: 1 },
      { optionId: OPTION_A, rank: 2 },
    ]);

    const ports = createResultsPersistence(testEnv.DB);
    const projection = await ports.projectRankedResults(POLL_ID);
    expect(projection).not.toBeNull();
    if (!projection) return;
    expect(projection.representationVersion).toBe(3);
    expect(projection.voterCount).toBe(4);
    expect(projection.resolved).toBe(true);
    expect(projection.winnerId).toBe(OPTION_A);
    expect(projection.winnerLabel).toBe("Pizza");
    expect(projection.rounds.length).toBe(1);
  });

  it("queryResults returns ranked_visible only after authorization", async () => {
    await insertBallot("v1", [{ optionId: OPTION_A, rank: 1 }]);
    await insertBallot("v2", [{ optionId: OPTION_A, rank: 1 }]);

    const ports = createResultsPersistence(testEnv.DB);
    const visible = await queryResults(
      ports,
      "rank-lunch",
      { userId: null },
      NOW,
    );
    expect(visible.kind).toBe("ranked_visible");
    if (visible.kind === "ranked_visible") {
      expect(visible.ranked.winnerLabel).toBe("Pizza");
      expect(visible.validator).toBe('"3:open"');
    }

    await testEnv.DB.prepare(
      "UPDATE poll SET result_visibility = 'after_close', deadline_ms = ?1 WHERE id = ?2",
    )
      .bind(NOW + 60_000, POLL_ID)
      .run();

    const hidden = await queryResults(
      ports,
      "rank-lunch",
      { userId: null },
      NOW,
    );
    expect(hidden.kind).toBe("after_close_hidden");
  });

  it("queryLiveResults serves ranked payload and respects ETag", async () => {
    await insertBallot("v1", [{ optionId: OPTION_A, rank: 1 }]);
    await insertBallot("v2", [{ optionId: OPTION_B, rank: 1 }]);
    await insertBallot("v3", [{ optionId: OPTION_A, rank: 1 }]);

    const ports = createResultsPersistence(testEnv.DB);
    const live = await queryLiveResults(
      ports,
      "rank-lunch",
      { userId: null },
      NOW,
    );
    expect(live.kind).toBe("ranked_visible");
    if (live.kind === "ranked_visible") {
      expect(live.ranked.winnerId).toBe(OPTION_A);
      expect(live.representationVersion).toBe(3);
    }

    const notModified = await queryLiveResults(
      ports,
      "rank-lunch",
      { userId: null },
      NOW,
      '"3:open"',
    );
    expect(notModified.kind).toBe("not_modified");
  });

  it("empty ranked Poll projects empty rounds without inventing a MC tally", async () => {
    const ports = createResultsPersistence(testEnv.DB);
    const projection = await ports.projectRankedResults(POLL_ID);
    expect(projection).not.toBeNull();
    if (!projection) return;
    expect(projection.empty).toBe(true);
    expect(projection.voterCount).toBe(0);
    expect(projection.rounds).toEqual([]);
    expect(projection.resolved).toBe(false);
  });
});
