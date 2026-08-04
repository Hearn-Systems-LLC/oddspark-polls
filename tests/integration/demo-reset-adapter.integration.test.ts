import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createDemoPollPersistence } from "../../src/adapters/d1/demo-poll";
import type { PollId, PollOptionId, UserId } from "../../src/shared/domain/index";

type TestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;
const OWNER = "demo-reset-owner" as UserId;
const ADMIN = "demo-reset-admin" as UserId;

async function seedDemo(options: {
  discoveryState?: "unlisted" | "listed" | "delisted";
  moderation?: boolean;
  voterCount?: number;
  version?: number;
} = {}): Promise<{ pollId: PollId; optionIds: PollOptionId[] }> {
  const pollId = crypto.randomUUID() as PollId;
  const optionIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()] as PollOptionId[];
  const now = 1_800_000_000_000;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?1, 'Demo Owner', 'demo-reset@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')
       ON CONFLICT(id) DO NOTHING`,
    ).bind(OWNER),
    testEnv.DB.prepare(
      `INSERT INTO poll (
        id, owner_user_id, poll_type, question, description, result_visibility,
        discovery_state, session_checks_enabled, ip_checks_enabled,
        voter_codes_enabled, captcha_enabled, vpn_blocking_enabled,
        multi_select_enabled, min_selections, max_selections, deadline_ms,
        closed_at_ms, representation_version, created_at_ms, updated_at_ms
      ) VALUES (
        ?1, ?2, 'multiple_choice', 'Best day for a long weekend?', 'Notes', 'live',
        ?3, 1, 0, 0, 1, 0, 0, NULL, NULL, NULL, NULL, ?4, ?5, ?5
      )`,
    ).bind(pollId, OWNER, options.discoveryState ?? "listed", options.version ?? 7, now),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Friday', 0, ?3)",
    ).bind(optionIds[0], pollId, now),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Monday', 1, ?3)",
    ).bind(optionIds[1], pollId, now),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Either works', 2, ?3)",
    ).bind(optionIds[2], pollId, now),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('demo', ?1, 'custom', 1, ?2)",
    ).bind(pollId, now),
  ]);
  for (let index = 0; index < (options.voterCount ?? 1); index += 1) {
    const voteId = crypto.randomUUID();
    await testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(voteId, pollId, `submission-${voteId}`, `payload-${voteId}`, now + index).run();
  }
  if (options.moderation) {
    await testEnv.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at, role)
       VALUES (?1, 'Administrator', 'demo-reset-admin@example.test', 1,
         '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', 'administrator')`,
    ).bind(ADMIN).run();
    await testEnv.DB.prepare(
      `INSERT INTO moderation_action (
        poll_id, actor_user_id, action, prior_state, next_state, created_at_ms
      ) VALUES (?1, ?2, 'delist', 'listed', 'delisted', ?3)`,
    ).bind(pollId, ADMIN, now).run();
  }
  return { pollId, optionIds };
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  for (const trigger of [
    "demo_test_block_option_move",
    "demo_test_block_reference_move",
    "demo_test_block_old_delete",
  ]) {
    await testEnv.DB.prepare(`DROP TRIGGER IF EXISTS ${trigger}`).run();
  }
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("DELETE FROM user").run();
});

describe("Demo Poll D1 aggregate replacement", () => {
  it("moves stable options and reference, increments the live version, and cascades old Votes", async () => {
    const seeded = await seedDemo({ voterCount: 2, version: 7 });
    const successor = crypto.randomUUID() as PollId;
    const persistence = createDemoPollPersistence(testEnv.DB, () => successor);

    const loaded = await persistence.loadByReference("demo");
    expect(loaded?.voterCount).toBe(2);
    const outcome = await persistence.replace({
      reference: "demo",
      expectedPollId: seeded.pollId,
      ownerUserId: OWNER,
    });

    expect(outcome).toEqual({
      kind: "replaced",
      pollId: successor,
      representationVersion: 8,
    });
    const current = await persistence.loadByReference("demo");
    expect(current).toMatchObject({
      pollId: successor,
      canonicalReference: "demo",
      ownerUserId: OWNER,
      description: "Notes",
      discoveryState: "listed",
      representationVersion: 8,
      voterCount: 0,
      moderationActionCount: 0,
    });
    expect(current?.options.map((option) => option.id)).toEqual(seeded.optionIds);
    expect(await testEnv.DB.prepare("SELECT id FROM poll WHERE id = ?1").bind(seeded.pollId).first()).toBeNull();
    expect(await testEnv.DB.prepare("SELECT id FROM vote WHERE poll_id = ?1").bind(seeded.pollId).first()).toBeNull();
  });

  it("uses the transaction-current version so Vote-first V becomes successor V+2", async () => {
    // Pre-race V=7; the committed Vote owns the ordinary V+1 increment before
    // this adapter linearizes. Reset must read 8 inside INSERT...SELECT and
    // create version 9, never reuse a stale pre-read 7.
    const seeded = await seedDemo({ voterCount: 1, version: 8 });
    const successor = crypto.randomUUID() as PollId;
    const persistence = createDemoPollPersistence(testEnv.DB, () => successor);

    await expect(persistence.replace({
      reference: "demo",
      expectedPollId: seeded.pollId,
      ownerUserId: OWNER,
    })).resolves.toEqual({
      kind: "replaced",
      pollId: successor,
      representationVersion: 9,
    });
    expect((await persistence.loadByReference("demo"))?.representationVersion).toBe(9);
  });

  it("leaves the aggregate unchanged when the old target is empty", async () => {
    const seeded = await seedDemo({ voterCount: 0 });
    const persistence = createDemoPollPersistence(testEnv.DB);
    await expect(persistence.replace({ reference: "demo", expectedPollId: seeded.pollId, ownerUserId: OWNER })).resolves.toEqual({ kind: "stale" });
    expect((await persistence.loadByReference("demo"))?.pollId).toBe(seeded.pollId);
  });

  it("refuses current or historic moderation without deleting its fact", async () => {
    const seeded = await seedDemo({ discoveryState: "delisted", moderation: true });
    const persistence = createDemoPollPersistence(testEnv.DB);
    await expect(persistence.replace({ reference: "demo", expectedPollId: seeded.pollId, ownerUserId: OWNER })).resolves.toEqual({ kind: "stale" });
    expect(await testEnv.DB.prepare("SELECT COUNT(*) AS count FROM moderation_action WHERE poll_id = ?1").bind(seeded.pollId).first<{ count: number }>()).toEqual({ count: 1 });
  });

  it("does not replace an owner or reference mismatch", async () => {
    const seeded = await seedDemo();
    const persistence = createDemoPollPersistence(testEnv.DB);
    await expect(persistence.replace({ reference: "another", expectedPollId: seeded.pollId, ownerUserId: OWNER })).resolves.toEqual({ kind: "stale" });
    await expect(persistence.replace({ reference: "demo", expectedPollId: seeded.pollId, ownerUserId: "other" as UserId })).resolves.toEqual({ kind: "stale" });
    expect((await persistence.loadByReference("demo"))?.pollId).toBe(seeded.pollId);
  });

  it.each([
    [
      "option move",
      `CREATE TRIGGER demo_test_block_option_move
       BEFORE UPDATE OF poll_id ON poll_option
       BEGIN SELECT RAISE(IGNORE); END`,
    ],
    [
      "reference move",
      `CREATE TRIGGER demo_test_block_reference_move
       BEFORE UPDATE OF poll_id ON poll_reference
       BEGIN SELECT RAISE(IGNORE); END`,
    ],
    [
      "old aggregate delete",
      `CREATE TRIGGER demo_test_block_old_delete
       BEFORE DELETE ON poll
       BEGIN SELECT RAISE(IGNORE); END`,
    ],
  ])("rolls a blocked %s stage back through the duplicate-reference assertion", async (_stage, triggerSql) => {
    const seeded = await seedDemo({ voterCount: 1 });
    await testEnv.DB.prepare(triggerSql).run();
    const successor = crypto.randomUUID() as PollId;
    const persistence = createDemoPollPersistence(testEnv.DB, () => successor);

    await expect(
      persistence.replace({
        reference: "demo",
        expectedPollId: seeded.pollId,
        ownerUserId: OWNER,
      }),
    ).resolves.toEqual({ kind: "stale" });

    const current = await persistence.loadByReference("demo");
    expect(current?.pollId).toBe(seeded.pollId);
    expect(current?.voterCount).toBe(1);
    expect(current?.options.map((option) => option.id)).toEqual(seeded.optionIds);
    expect(
      await testEnv.DB.prepare("SELECT id FROM poll WHERE id = ?1").bind(successor).first(),
    ).toBeNull();
  });
});
