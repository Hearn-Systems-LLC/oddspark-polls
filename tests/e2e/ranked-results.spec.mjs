import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  cleanupCreator,
  d1Execute,
  hasBetterAuthSecret,
  requireBaseUrl,
  seedCreatorSession,
  sql,
} from "./creator-session.mjs";

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(
  !hasBetterAuthSecret(),
  "BETTER_AUTH_SECRET is required for Ranked Results journeys",
);

const PROOF_DIR = "test-results/story-5-2-ranked-results-proof";
mkdirSync(PROOF_DIR, { recursive: true });

let owner;

function seedRankedResultsPoll(ownerUserId, reference, { closed = false } = {}) {
  const pollId = randomUUID();
  const optionIds = [randomUUID(), randomUUID(), randomUUID()];
  const now = Date.now();
  const closedAt = closed ? now - 1_000 : null;
  const statements = [
    sql`INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, discovery_state, session_checks_enabled, comments_enabled, multi_select_enabled, min_selections, max_selections, representation_version, closed_at_ms, created_at_ms, updated_at_ms) VALUES (${pollId}, ${ownerUserId}, 'ranked_choice', 'Who wins the ranked race?', 'live', 'unlisted', 0, 1, 0, NULL, NULL, 1, ${closedAt}, ${now}, ${now});`,
    sql`INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (${optionIds[0]}, ${pollId}, 'Alpha', 0, ${now}), (${optionIds[1]}, ${pollId}, 'Beta', 1, ${now}), (${optionIds[2]}, ${pollId}, 'Gamma', 2, ${now});`,
    sql`INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${reference}, ${pollId}, 'custom', 1, ${now});`,
  ];

  // 3 Alpha first, 1 Beta first → Alpha majority.
  for (let i = 0; i < 3; i++) {
    const voteId = randomUUID();
    statements.push(
      sql`INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (${voteId}, ${pollId}, ${`sub-a-${i}`}, ${`hash-a-${i}`}, ${now});`,
      sql`INSERT INTO ranked_vote_preference (vote_id, poll_option_id, preference_rank) VALUES (${voteId}, ${optionIds[0]}, 1), (${voteId}, ${optionIds[1]}, 2);`,
    );
  }
  {
    const voteId = randomUUID();
    statements.push(
      sql`INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (${voteId}, ${pollId}, ${"sub-b-0"}, ${"hash-b-0"}, ${now});`,
      sql`INSERT INTO ranked_vote_preference (vote_id, poll_option_id, preference_rank) VALUES (${voteId}, ${optionIds[1]}, 1), (${voteId}, ${optionIds[0]}, 2);`,
    );
  }

  d1Execute(sql.join(statements));
  return { pollId, optionIds, reference };
}

function seedUnresolvedRankedPoll(ownerUserId, reference) {
  const pollId = randomUUID();
  const optionIds = [randomUUID(), randomUUID()];
  const now = Date.now();
  const statements = [
    sql`INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, discovery_state, session_checks_enabled, comments_enabled, multi_select_enabled, min_selections, max_selections, representation_version, created_at_ms, updated_at_ms) VALUES (${pollId}, ${ownerUserId}, 'ranked_choice', 'Perfect split?', 'live', 'unlisted', 0, 1, 0, NULL, NULL, 1, ${now}, ${now});`,
    sql`INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (${optionIds[0]}, ${pollId}, 'Left', 0, ${now}), (${optionIds[1]}, ${pollId}, 'Right', 1, ${now});`,
    sql`INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (${reference}, ${pollId}, 'custom', 1, ${now});`,
  ];
  for (const [label, optionId] of [
    ["left", optionIds[0]],
    ["right", optionIds[1]],
  ]) {
    const voteId = randomUUID();
    statements.push(
      sql`INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (${voteId}, ${pollId}, ${`sub-${label}`}, ${`hash-${label}`}, ${now});`,
      sql`INSERT INTO ranked_vote_preference (vote_id, poll_option_id, preference_rank) VALUES (${voteId}, ${optionId}, 1);`,
    );
  }
  d1Execute(sql.join(statements));
  return { pollId, optionIds, reference };
}

test.describe("Story 5.2 Ranked IRV Results", () => {
  test.beforeAll(async () => {
    owner = await seedCreatorSession();
  });

  test.afterAll(async () => {
    if (owner) await cleanupCreator(owner);
  });

  test("renders ranked winner summary without Comments on open Results", async ({
    page,
  }) => {
    requireBaseUrl();
    const fixture = seedRankedResultsPoll(
      owner.userId,
      `rank-win-${randomUUID().slice(0, 8)}`,
    );

    await page.goto(`/${fixture.reference}/results`, {
      waitUntil: "networkidle",
    });
    await expect(page.locator("[data-ranked-results]")).toBeVisible();
    await expect(page.locator("[data-ranked-outcome]")).toContainText(
      "Winner: Alpha",
    );
    await expect(page.locator("[data-ranked-results-unavailable]")).toHaveCount(
      0,
    );
    await expect(page.locator("text=Comment")).toHaveCount(0);
    await page.screenshot({
      path: `${PROOF_DIR}/open-winner.png`,
      fullPage: true,
    });
  });

  test("serves ranked live JSON with ETag for authorized open Polls", async ({
    request,
  }) => {
    requireBaseUrl();
    const fixture = seedRankedResultsPoll(
      owner.userId,
      `rank-live-${randomUUID().slice(0, 8)}`,
    );

    const first = await request.get(`/${fixture.reference}/results/live`);
    expect(first.status()).toBe(200);
    const etag = first.headers()["etag"];
    expect(etag).toBeTruthy();
    const body = await first.json();
    expect(body.pollType).toBe("ranked_choice");
    expect(body.resolved).toBe(true);
    expect(body.winnerLabel).toBe("Alpha");
    expect(body.comments).toEqual([]);

    const second = await request.get(`/${fixture.reference}/results/live`, {
      headers: { "if-none-match": etag },
    });
    expect(second.status()).toBe(304);
  });

  test("shows unresolved tie as a terminal ranked result", async ({ page }) => {
    requireBaseUrl();
    const fixture = seedUnresolvedRankedPoll(
      owner.userId,
      `rank-tie-${randomUUID().slice(0, 8)}`,
    );

    await page.goto(`/${fixture.reference}/results`, {
      waitUntil: "networkidle",
    });
    await expect(page.locator("[data-ranked-outcome]")).toContainText(
      "Unresolved tie",
    );
    await expect(page.locator(".ranked-standing-row.is-tied")).toHaveCount(2);
  });

  test("closed ranked Poll still shows the IRV summary", async ({ page }) => {
    requireBaseUrl();
    const fixture = seedRankedResultsPoll(
      owner.userId,
      `rank-closed-${randomUUID().slice(0, 8)}`,
      { closed: true },
    );

    await page.goto(`/${fixture.reference}/results`, {
      waitUntil: "networkidle",
    });
    await expect(page.locator("[data-ranked-outcome]")).toContainText(
      "Winner: Alpha",
    );
    await expect(page.locator("[data-ranked-results]")).toHaveAttribute(
      "data-status",
      "closed",
    );
  });
});
