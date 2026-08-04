import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;

async function insertUser(id: string, role?: string): Promise<void> {
  const now = new Date().toISOString();
  if (role === undefined) {
    await testEnv.DB.prepare(
      `INSERT INTO user
        (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, 'Creator', ?, 1, ?, ?)`,
    )
      .bind(id, `${id}@example.test`, now, now)
      .run();
    return;
  }

  await testEnv.DB.prepare(
    `INSERT INTO user
      (id, name, email, email_verified, created_at, updated_at, role)
     VALUES (?, 'Creator', ?, 1, ?, ?, ?)`,
  )
    .bind(id, `${id}@example.test`, now, now, role)
    .run();
}

async function insertPoll(ownerUserId: string, pollId: string): Promise<void> {
  const nowMs = Date.now();
  await testEnv.DB.prepare(
    `INSERT INTO poll (
      id, owner_user_id, poll_type, question, description,
      result_visibility, discovery_state, session_checks_enabled,
      multi_select_enabled, min_selections, max_selections,
      deadline_ms, closed_at_ms, representation_version,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, 'multiple_choice', 'Moderate this?', NULL,
      'live', 'listed', 1, 0, NULL, NULL, NULL, NULL, 1, ?, ?)`,
  )
    .bind(pollId, ownerUserId, nowMs, nowMs)
    .run();
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM moderation_action").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("DELETE FROM user").run();
});

describe("Administrator moderation schema", () => {
  it("defaults every user to creator and permits at most one Administrator", async () => {
    const suffix = crypto.randomUUID();
    const creatorOne = `creator-one-${suffix}`;
    const administratorOne = `administrator-one-${suffix}`;
    const creatorTwo = `creator-two-${suffix}`;

    await insertUser(creatorOne);
    await insertUser(administratorOne, "administrator");
    await insertUser(creatorTwo, "creator");

    const roles = await testEnv.DB.prepare(
      "SELECT id, role FROM user ORDER BY id",
    ).all<{ id: string; role: string }>();
    expect(roles.results).toEqual([
      { id: administratorOne, role: "administrator" },
      { id: creatorOne, role: "creator" },
      { id: creatorTwo, role: "creator" },
    ]);

    await expect(
      insertUser(`administrator-two-${suffix}`, "administrator"),
    ).rejects.toThrow();
    await expect(
      testEnv.DB.prepare(
        "UPDATE user SET role = 'administrator' WHERE id = ?",
      )
        .bind(creatorTwo)
        .run(),
    ).rejects.toThrow();
    await expect(insertUser(`unknown-role-${suffix}`, "admin")).rejects.toThrow();
  });

  it("stores only legal ordered moderation transitions", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const administratorId = `administrator-${suffix}`;
    const pollId = `poll-${suffix}`;
    await insertUser(ownerId);
    await insertUser(administratorId, "administrator");
    await insertPoll(ownerId, pollId);

    await testEnv.DB.prepare(
      `INSERT INTO moderation_action
        (poll_id, actor_user_id, action, prior_state, next_state, created_at_ms)
       VALUES (?, ?, 'delist', 'listed', 'delisted', ?)`,
    )
      .bind(pollId, administratorId, 1_700_000_000_000)
      .run();
    await testEnv.DB.prepare(
      `INSERT INTO moderation_action
        (poll_id, actor_user_id, action, prior_state, next_state, created_at_ms)
       VALUES (?, ?, 'clear_delisted', 'delisted', 'listed', ?)`,
    )
      .bind(pollId, administratorId, 1_700_000_000_000)
      .run();

    const rows = await testEnv.DB.prepare(
      `SELECT sequence, action, prior_state, next_state
       FROM moderation_action ORDER BY sequence`,
    ).all<{
      sequence: number;
      action: string;
      prior_state: string;
      next_state: string;
    }>();
    expect(rows.results).toEqual([
      {
        sequence: 1,
        action: "delist",
        prior_state: "listed",
        next_state: "delisted",
      },
      {
        sequence: 2,
        action: "clear_delisted",
        prior_state: "delisted",
        next_state: "listed",
      },
    ]);

    await expect(
      testEnv.DB.prepare(
        `INSERT INTO moderation_action
          (poll_id, actor_user_id, action, prior_state, next_state, created_at_ms)
         VALUES (?, ?, 'delist', 'delisted', 'listed', ?)`,
      )
        .bind(pollId, administratorId, 1)
        .run(),
    ).rejects.toThrow();
    await expect(
      testEnv.DB.prepare(
        `INSERT INTO moderation_action
          (poll_id, actor_user_id, action, prior_state, next_state, created_at_ms)
         VALUES (?, ?, 'delist', 'listed', 'delisted', -1)`,
      )
        .bind(pollId, administratorId)
        .run(),
    ).rejects.toThrow();
  });

  it("cascades Poll actions but restricts deletion of a recorded actor", async () => {
    const suffix = crypto.randomUUID();
    const ownerId = `owner-${suffix}`;
    const administratorId = `administrator-${suffix}`;
    const pollId = `poll-${suffix}`;
    await insertUser(ownerId);
    await insertUser(administratorId, "administrator");
    await insertPoll(ownerId, pollId);
    await testEnv.DB.prepare(
      `INSERT INTO moderation_action
        (poll_id, actor_user_id, action, prior_state, next_state, created_at_ms)
       VALUES (?, ?, 'delist', 'listed', 'delisted', 1)`,
    )
      .bind(pollId, administratorId)
      .run();

    await expect(
      testEnv.DB.prepare("DELETE FROM user WHERE id = ?").bind(administratorId).run(),
    ).rejects.toThrow();
    await testEnv.DB.prepare("DELETE FROM poll WHERE id = ?").bind(pollId).run();
    const count = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM moderation_action",
    ).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });
});
