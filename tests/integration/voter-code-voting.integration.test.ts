import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createVotePersistence } from "../../src/adapters/d1/index";
import { castVote, VoterCodeAlreadyUsedError } from "../../src/modules/voting/index";
import { votingStrategyFor } from "../../src/modules/polls/types/registry";
import { sha256Hex } from "../../src/adapters/digest/index";
import type { PollId, PollOptionId } from "../../src/shared/domain/index";
import type { VoterClaimDigest } from "../../src/modules/voting/index";

type TestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as TestEnv;

const POLL_ID = crypto.randomUUID() as PollId;
const OPTION_A = crypto.randomUUID() as PollOptionId;
const OPTION_B = crypto.randomUUID() as PollOptionId;
const OWNER_ID = crypto.randomUUID();
const NOW = Date.now();

async function seedPoll(voterCodesEnabled: boolean): Promise<void> {
  await testEnv.DB.prepare(
    "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Owner', 'owner@test.example', 1, ?2, ?2)",
  ).bind(OWNER_ID, NOW).run();
  await testEnv.DB.prepare(
    "INSERT INTO poll (id, owner_user_id, poll_type, question, description, result_visibility, discovery_state, session_checks_enabled, ip_checks_enabled, voter_codes_enabled, captcha_enabled, vpn_blocking_enabled, comments_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, representation_version, created_at_ms, updated_at_ms) VALUES (?1, ?2, 'multiple_choice', 'Test', '', 'public', 'unlisted', 0, 0, ?3, 0, 0, 0, 0, NULL, NULL, NULL, 0, ?4, ?4)",
  ).bind(POLL_ID, OWNER_ID, voterCodesEnabled ? 1 : 0, NOW).run();
  await testEnv.DB.prepare(
    "INSERT INTO poll_reference (poll_id, reference, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'canonical', 1, ?3)",
  ).bind(POLL_ID, crypto.randomUUID(), NOW).run();
  await testEnv.DB.prepare(
    "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'A', 0, ?3)",
  ).bind(OPTION_A, POLL_ID, NOW).run();
  await testEnv.DB.prepare(
    "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'B', 1, ?3)",
  ).bind(OPTION_B, POLL_ID, NOW).run();
}

async function seedVoterCode(code: string): Promise<string> {
  const codeId = crypto.randomUUID();
  await testEnv.DB.prepare(
    "INSERT INTO voter_code (id, poll_id, batch_id, position, code, created_at_ms) VALUES (?1, ?2, ?3, 0, ?4, ?5)",
  ).bind(codeId, POLL_ID, crypto.randomUUID(), code, NOW).run();
  return codeId;
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
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

function makeDeps() {
  const persistence = createVotePersistence(testEnv.DB);
  return {
    findPoll: persistence.findPoll,
    findVoteBySubmission: persistence.findVoteBySubmission,
    optionsStillReachable: persistence.optionsStillReachable,
    strategyFor: votingStrategyFor,
    createDigest: async () => "a".repeat(64) as VoterClaimDigest,
    hashPayload: sha256Hex,
    persistVote: persistence.insertVote,
    lookupVoterCode: persistence.lookupVoterCode,
    generateId: () => crypto.randomUUID(),
    nowMs: () => NOW,
  };
}

describe("voter code admission in castVote", () => {
  it("accepts a valid unused code and creates a redemption", async () => {
    await seedPoll(true);
    await seedVoterCode("ABCDEFGH");
    const deps = makeDeps();
    const result = await castVote(deps, {
      pollId: POLL_ID,
      submissionId: crypto.randomUUID(),
      selectedOptionIds: [OPTION_A],
      browserToken: null,
      ipDigest: null,
      humanChallenge: "not_attempted",
      voterCode: "ABCDEFGH",
    });
    expect(result.ok).toBe(true);

    const redemption = await testEnv.DB.prepare(
      "SELECT code_id, vote_id FROM voter_code_redemptions LIMIT 1",
    ).first<{ code_id: string; vote_id: string }>();
    expect(redemption).not.toBeNull();
  });

  it("rejects missing code when toggle is on", async () => {
    await seedPoll(true);
    const deps = makeDeps();
    const result = await castVote(deps, {
      pollId: POLL_ID,
      submissionId: crypto.randomUUID(),
      selectedOptionIds: [OPTION_A],
      browserToken: null,
      ipDigest: null,
      humanChallenge: "not_attempted",
      voterCode: "",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("voter_code_missing");
    }
  });

  it("rejects malformed code", async () => {
    await seedPoll(true);
    const deps = makeDeps();
    const result = await castVote(deps, {
      pollId: POLL_ID,
      submissionId: crypto.randomUUID(),
      selectedOptionIds: [OPTION_A],
      browserToken: null,
      ipDigest: null,
      humanChallenge: "not_attempted",
      voterCode: "BAD0CODE",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("voter_code_invalid");
    }
  });

  it("rejects nonexistent code", async () => {
    await seedPoll(true);
    const deps = makeDeps();
    const result = await castVote(deps, {
      pollId: POLL_ID,
      submissionId: crypto.randomUUID(),
      selectedOptionIds: [OPTION_A],
      browserToken: null,
      ipDigest: null,
      humanChallenge: "not_attempted",
      voterCode: "ZZZZZZZZ",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("voter_code_invalid");
    }
  });

  it("rejects already-redeemed code", async () => {
    await seedPoll(true);
    const codeId = await seedVoterCode("ABCDEFGH");
    // Pre-redeem
    const voteId = crypto.randomUUID();
    await testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
    ).bind(voteId, POLL_ID, crypto.randomUUID(), "hash", NOW).run();
    await testEnv.DB.prepare(
      "INSERT INTO voter_code_redemptions (code_id, vote_id, redeemed_at_ms) VALUES (?1, ?2, ?3)",
    ).bind(codeId, voteId, NOW).run();

    const deps = makeDeps();
    const result = await castVote(deps, {
      pollId: POLL_ID,
      submissionId: crypto.randomUUID(),
      selectedOptionIds: [OPTION_A],
      browserToken: null,
      ipDigest: null,
      humanChallenge: "not_attempted",
      voterCode: "ABCDEFGH",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("voter_code_used");
    }
  });

  it("ignores forged code when toggle is off", async () => {
    await seedPoll(false);
    const deps = makeDeps();
    const result = await castVote(deps, {
      pollId: POLL_ID,
      submissionId: crypto.randomUUID(),
      selectedOptionIds: [OPTION_A],
      browserToken: null,
      ipDigest: null,
      humanChallenge: "not_attempted",
      voterCode: "FARGED22",
    });
    expect(result.ok).toBe(true);

    const redemptions = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM voter_code_redemptions",
    ).first<{ cnt: number }>();
    expect(redemptions?.cnt).toBe(0);
  });

  it("creates exactly one version increment with redemption", async () => {
    await seedPoll(true);
    await seedVoterCode("ABCDEFGH");
    const deps = makeDeps();
    const result = await castVote(deps, {
      pollId: POLL_ID,
      submissionId: crypto.randomUUID(),
      selectedOptionIds: [OPTION_A],
      browserToken: null,
      ipDigest: null,
      humanChallenge: "not_attempted",
      voterCode: "ABCDEFGH",
    });
    expect(result.ok).toBe(true);

    const poll = await testEnv.DB.prepare(
      "SELECT representation_version FROM poll WHERE id = ?1",
    ).bind(POLL_ID).first<{ representation_version: number }>();
    expect(poll?.representation_version).toBe(1);
  });
});

describe("concurrent code race", () => {
  it("two concurrent votes on one code produce exactly one success and one used error", async () => {
    await seedPoll(true);
    await seedVoterCode("RACECDE2");
    const deps = makeDeps();
    const sharedInput = {
      pollId: POLL_ID,
      selectedOptionIds: [OPTION_A] as readonly string[],
      browserToken: null,
      ipDigest: null,
      humanChallenge: "not_attempted" as const,
      voterCode: "RACECDE2",
    };

    const [resultA, resultB] = await Promise.all([
      castVote(deps, { ...sharedInput, submissionId: crypto.randomUUID() }),
      castVote(deps, { ...sharedInput, submissionId: crypto.randomUUID() }),
    ]);

    const outcomes = [resultA, resultB];
    const successes = outcomes.filter((r) => r.ok);
    const failures = outcomes.filter((r) => !r.ok);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (!failures[0].ok) {
      expect(failures[0].error.code).toBe("voter_code_used");
    }

    const redemptions = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM voter_code_redemptions",
    ).first<{ cnt: number }>();
    expect(redemptions?.cnt).toBe(1);

    const votes = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM vote WHERE poll_id = ?1",
    ).bind(POLL_ID).first<{ cnt: number }>();
    expect(votes?.cnt).toBe(1);
  });
});
