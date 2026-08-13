import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createVoterCodesD1Adapter } from "../../src/adapters/d1/voter-codes";
import { generateVoterCodes, VOTER_CODE_BATCH_DEFAULT } from "../../src/modules/voting/voter-codes";
import type { PollId, UserId } from "../../src/shared/domain/index";

type TestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as TestEnv;

async function seedOwner(): Promise<string> {
  const id = crypto.randomUUID();
  await testEnv.DB.prepare(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, ?2, ?3, 1, ?4, ?4)",
  ).bind(id, "Test Owner", `${crypto.randomUUID()}@example.test`, Date.now()).run();
  return id;
}

async function seedPoll(ownerUserId: string, opts?: { voterCodesEnabled?: boolean; closed?: boolean }): Promise<PollId> {
  const pollId = crypto.randomUUID() as PollId;
  const now = Date.now();
  await testEnv.DB.prepare(
    "INSERT INTO poll (id, owner_user_id, poll_type, question, description, result_visibility, discovery_state, session_checks_enabled, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled, comments_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, representation_version, created_at_ms, updated_at_ms) VALUES (?1, ?2, 'multiple_choice', 'Test Poll', '', 'public', 'unlisted', 0, 0, ?3, 0, 0, 0, 0, NULL, NULL, ?4, 0, ?5, ?5)",
  ).bind(pollId, ownerUserId, opts?.voterCodesEnabled ? 1 : 0, opts?.closed ? now - 1000 : null, now).run();
  await testEnv.DB.prepare(
    "INSERT INTO poll_reference (poll_id, reference, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'canonical', 1, ?3)",
  ).bind(pollId, crypto.randomUUID(), now).run();
  return pollId;
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  // FK-ordered cleanup
  await testEnv.DB.prepare("DELETE FROM voter_code_redemptions").run();
  await testEnv.DB.prepare("DELETE FROM voter_code").run();
  await testEnv.DB.prepare("DELETE FROM vote_comment").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM ranked_vote_preference").run();
  await testEnv.DB.prepare("DELETE FROM meeting_availability").run();
  await testEnv.DB.prepare("DELETE FROM meeting_response").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("DELETE FROM user").run();
});

describe("migration 0019 voter code shape guards", () => {
  it("rejects insert of code with wrong length", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO voter_code (id, poll_id, batch_id, position, code, created_at_ms) VALUES (?1, ?2, ?3, 0, 'SHORT', ?4)",
      ).bind(crypto.randomUUID(), pollId, crypto.randomUUID(), Date.now()).run(),
    ).rejects.toThrow(/voter_code_shape_invalid/);
  });

  it("rejects insert of code with forbidden characters (0, 1, I, O)", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO voter_code (id, poll_id, batch_id, position, code, created_at_ms) VALUES (?1, ?2, ?3, 0, 'ABCD0EFG', ?4)",
      ).bind(crypto.randomUUID(), pollId, crypto.randomUUID(), Date.now()).run(),
    ).rejects.toThrow(/voter_code_shape_invalid/);
  });

  it("rejects insert of code with punctuation outside the voter-code alphabet", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    await expect(
      testEnv.DB.prepare(
        "INSERT INTO voter_code (id, poll_id, batch_id, position, code, created_at_ms) VALUES (?1, ?2, ?3, 0, 'ABCDEFG$', ?4)",
      ).bind(crypto.randomUUID(), pollId, crypto.randomUUID(), Date.now()).run(),
    ).rejects.toThrow(/voter_code_shape_invalid/);
  });

  it("accepts valid 8-character code from the alphabet", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    await testEnv.DB.prepare(
      "INSERT INTO voter_code (id, poll_id, batch_id, position, code, created_at_ms) VALUES (?1, ?2, ?3, 0, 'ABCDEFGH', ?4)",
    ).bind(crypto.randomUUID(), pollId, crypto.randomUUID(), Date.now()).run();
    const row = await testEnv.DB.prepare("SELECT code FROM voter_code WHERE poll_id = ?1").bind(pollId).first<{ code: string }>();
    expect(row?.code).toBe("ABCDEFGH");
  });

  it("rejects update to invalid code shape", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    const codeId = crypto.randomUUID();
    await testEnv.DB.prepare(
      "INSERT INTO voter_code (id, poll_id, batch_id, position, code, created_at_ms) VALUES (?1, ?2, ?3, 0, 'ABCDEFGH', ?4)",
    ).bind(codeId, pollId, crypto.randomUUID(), Date.now()).run();
    await expect(
      testEnv.DB.prepare("UPDATE voter_code SET code = 'BAD0CODE' WHERE id = ?1").bind(codeId).run(),
    ).rejects.toThrow(/voter_code_shape_invalid/);
  });
});

describe("owner-qualified queries use owner_user_id", () => {
  it("findPollOwner returns correct owner via owner_user_id column", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    const adapter = createVoterCodesD1Adapter(testEnv.DB);
    const deps = adapter.generateDeps(ownerId);
    const result = await deps.findPollOwner(pollId);
    expect(result).not.toBeNull();
    expect(result!.ownerId).toBe(ownerId);
    expect(result!.voterCodesEnabled).toBe(true);
  });

  it("getInventory returns null for non-owner", async () => {
    const ownerId = await seedOwner();
    const otherId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    const adapter = createVoterCodesD1Adapter(testEnv.DB);
    const inventory = await adapter.getInventory(pollId, otherId);
    expect(inventory).toBeNull();
  });

  it("getInventory returns inventory for owner", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    const adapter = createVoterCodesD1Adapter(testEnv.DB);
    const deps = adapter.generateDeps(ownerId);
    const result = await generateVoterCodes(deps, {
      pollId,
      ownerId,
      count: 3,
      batchId: crypto.randomUUID(),
    });
    expect(result.ok).toBe(true);
    const inventory = await adapter.getInventory(pollId, ownerId);
    expect(inventory).not.toBeNull();
    expect(inventory!.total).toBe(3);
    expect(inventory!.codes).toHaveLength(3);
  });
});

describe("generation concurrency and replay", () => {
  it("exact-batch replay returns existing inventory without duplicating", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    const adapter = createVoterCodesD1Adapter(testEnv.DB);
    const deps = adapter.generateDeps(ownerId);
    const batchId = crypto.randomUUID();

    const first = await generateVoterCodes(deps, {
      pollId,
      ownerId,
      count: 5,
      batchId,
    });
    expect(first.ok).toBe(true);

    const second = await generateVoterCodes(deps, {
      pollId,
      ownerId,
      count: 5,
      batchId,
    });
    expect(second.ok).toBe(true);
    if (second.ok && first.ok) {
      expect(second.value.codes.map((c) => c.code)).toEqual(first.value.codes.map((c) => c.code));
    }

    const inventory = await adapter.getInventory(pollId, ownerId);
    expect(inventory!.total).toBe(5);
  });

  it("batch conflict when same batch_id but different count", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    const adapter = createVoterCodesD1Adapter(testEnv.DB);
    const deps = adapter.generateDeps(ownerId);
    const batchId = crypto.randomUUID();

    await generateVoterCodes(deps, { pollId, ownerId, count: 5, batchId });
    const conflict = await generateVoterCodes(deps, { pollId, ownerId, count: 10, batchId });
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) {
      expect(conflict.error.code).toBe("voter_code_batch_conflict");
    }
  });

  it("rejects generation when toggle is off", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: false });
    const adapter = createVoterCodesD1Adapter(testEnv.DB);
    const deps = adapter.generateDeps(ownerId);
    const result = await generateVoterCodes(deps, {
      pollId,
      ownerId,
      count: 5,
      batchId: crypto.randomUUID(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("voter_code_generation_disabled");
    }
  });

  it("rejects generation when poll is closed", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true, closed: true });
    const adapter = createVoterCodesD1Adapter(testEnv.DB);
    const deps = adapter.generateDeps(ownerId);
    const result = await generateVoterCodes(deps, {
      pollId,
      ownerId,
      count: 5,
      batchId: crypto.randomUUID(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("voter_code_generation_closed");
    }
  });
});

describe("redeemed projection", () => {
  it("shows redeemed count correctly after redemption insert", async () => {
    const ownerId = await seedOwner();
    const pollId = await seedPoll(ownerId, { voterCodesEnabled: true });
    const adapter = createVoterCodesD1Adapter(testEnv.DB);
    const deps = adapter.generateDeps(ownerId);
    const result = await generateVoterCodes(deps, {
      pollId,
      ownerId,
      count: 3,
      batchId: crypto.randomUUID(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Simulate a redemption by inserting directly (as castVote would)
    const codeId = result.value.codes[0].id;
    const voteId = crypto.randomUUID();
    const now = Date.now();
    await testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(voteId, pollId, crypto.randomUUID(), "hash", now).run();
    await testEnv.DB.prepare(
      "INSERT INTO voter_code_redemptions (code_id, vote_id, redeemed_at_ms) VALUES (?1, ?2, ?3)",
    ).bind(codeId, voteId, now).run();

    const inventory = await adapter.getInventory(pollId, ownerId);
    expect(inventory).not.toBeNull();
    expect(inventory!.redeemed).toBe(1);
    expect(inventory!.total).toBe(3);
    const redeemedCode = inventory!.codes.find((c) => c.id === codeId);
    expect(redeemedCode?.redeemed).toBe(true);
  });
});
