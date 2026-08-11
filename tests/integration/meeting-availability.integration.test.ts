import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createVotePersistence } from "../../src/adapters/d1/index";
import { createVoteDigest, sha256Hex } from "../../src/adapters/digest/index";
import { votingStrategyFor } from "../../src/modules/polls/types/registry";
import { castVote } from "../../src/modules/voting/index";
import { incrementRepresentationVersion } from "../../src/shared/application/index";
import type { PollId } from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as MigrationTestEnv;
const NOW = 1_800_000_000_000;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM meeting_availability").run();
  await testEnv.DB.prepare("DELETE FROM meeting_response").run();
  await testEnv.DB.prepare("DELETE FROM meeting_slot").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("INSERT OR IGNORE INTO user (id,name,email,email_verified,created_at,updated_at) VALUES ('meeting-vote-owner','Creator','mv@example.test',1,'1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z')").run();
});

async function seed(pollId = "meeting-vote", type = "meeting") {
  await testEnv.DB.prepare("INSERT INTO poll (id,owner_user_id,poll_type,question,result_visibility,multi_select_enabled,representation_version,created_at_ms,updated_at_ms) VALUES (?1,'meeting-vote-owner',?2,'When?','live',0,1,?3,?3)").bind(pollId, type, NOW).run();
  if (type === "meeting") await testEnv.DB.prepare("INSERT INTO meeting_slot (id,poll_id,position,starts_at_ms,ends_at_ms,time_zone,created_at_ms) VALUES (?1,?2,0,?3,?4,'UTC',?3)").bind(`${pollId}-slot`, pollId, NOW, NOW + 60_000).run();
}

async function vote(pollId = "meeting-vote", id = "meeting-vote-1") {
  await testEnv.DB.prepare("INSERT INTO vote (id,poll_id,submission_id,payload_hash,created_at_ms) VALUES (?1,?2,?3,'hash',?4)").bind(id, pollId, `${id}-submission`, NOW).run();
}

describe("meeting availability schema (0017)", () => {
  it("commits one Vote, response, and all availability facts in one adapter batch", async () => {
    await seed();
    await createVotePersistence(testEnv.DB).insertVote({
      vote: { id: "meeting-vote-1", pollId: "meeting-vote" as PollId, submissionId: "meeting-submission", payloadHash: "payload", createdAtMs: NOW },
      contributions: [
        { kind: "meeting_response", voteId: "meeting-vote-1", displayName: "Alex", revisionCapabilityDigest: "a".repeat(64) },
        { kind: "meeting_availability", voteId: "meeting-vote-1", meetingSlotId: "meeting-vote-slot", availability: "if_need_be" },
      ],
      representationVersion: incrementRepresentationVersion("meeting-vote" as PollId, NOW),
    });
    await expect(testEnv.DB.prepare("SELECT display_name,revision_capability_digest FROM meeting_response").first()).resolves.toEqual({ display_name: "Alex", revision_capability_digest: "a".repeat(64) });
    await expect(testEnv.DB.prepare("SELECT availability FROM meeting_availability").first()).resolves.toEqual({ availability: "if_need_be" });
  });

  it("casts a Meeting response through the application command", async () => {
    await seed();
    const persistence = createVotePersistence(testEnv.DB);
    const digest = await createVoteDigest("meeting-test-secret", { pollId: "meeting-vote" as PollId, checkKind: "revision", token: "revision-token" });
    const result = await castVote({
      findPoll: persistence.findPoll,
      findVoteBySubmission: persistence.findVoteBySubmission,
      optionsStillReachable: persistence.optionsStillReachable,
      strategyFor: votingStrategyFor,
      createDigest: (input) => createVoteDigest("meeting-test-secret", input),
      hashPayload: sha256Hex,
      persistVote: persistence.insertVote,
      generateId: () => crypto.randomUUID(),
      nowMs: () => NOW,
    }, {
      pollId: "meeting-vote" as PollId,
      submissionId: crypto.randomUUID(),
      pollType: "meeting",
      selectedOptionIds: [],
      displayName: "Alex",
      availability: [{ slotId: "meeting-vote-slot", state: "yes", position: 0 }],
      revisionCapabilityDigest: digest,
      browserToken: "meeting-browser-token",
      ipDigest: null,
      humanChallenge: "not_attempted",
    });
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value).toMatchObject({ existing: false });
  });
  it("stores attributed availability and cascades it with the Vote", async () => {
    await seed(); await vote();
    await testEnv.DB.batch([
      testEnv.DB.prepare("INSERT INTO meeting_response (vote_id,display_name,revision_capability_digest) VALUES ('meeting-vote-1','Alex','digest')"),
      testEnv.DB.prepare("INSERT INTO meeting_availability (vote_id,meeting_slot_id,availability) VALUES ('meeting-vote-1','meeting-vote-slot','yes')"),
    ]);
    await testEnv.DB.prepare("DELETE FROM vote WHERE id='meeting-vote-1'").run();
    await expect(testEnv.DB.prepare("SELECT COUNT(*) count FROM meeting_response").first()).resolves.toMatchObject({ count: 0 });
    await expect(testEnv.DB.prepare("SELECT COUNT(*) count FROM meeting_availability").first()).resolves.toMatchObject({ count: 0 });
  });

  it("rejects invalid states, cross-poll slots, and non-Meeting Votes", async () => {
    await seed(); await seed("other-meeting"); await vote();
    await expect(testEnv.DB.prepare("INSERT INTO meeting_availability VALUES ('meeting-vote-1','meeting-vote-slot','maybe')").run()).rejects.toThrow(/CHECK constraint/);
    await expect(testEnv.DB.prepare("INSERT INTO meeting_availability VALUES ('meeting-vote-1','other-meeting-slot','yes')").run()).rejects.toThrow(/meeting_availability_slot_invalid/);
  });

  it("rejects availability writes after the Poll closes", async () => {
    await seed(); await vote();
    await testEnv.DB.prepare("UPDATE poll SET closed_at_ms=?1 WHERE id='meeting-vote'").bind(NOW).run();
    await expect(testEnv.DB.prepare("INSERT INTO meeting_availability VALUES ('meeting-vote-1','meeting-vote-slot','yes')").run()).rejects.toThrow(/poll_closed/);
  });

  it("enforces trimmed display names and one response per Vote", async () => {
    await seed(); await vote();
    await expect(testEnv.DB.prepare("INSERT INTO meeting_response VALUES ('meeting-vote-1','  ','digest')").run()).rejects.toThrow(/CHECK constraint/);
    await testEnv.DB.prepare("INSERT INTO meeting_response VALUES ('meeting-vote-1','Alex','digest')").run();
    await expect(testEnv.DB.prepare("INSERT INTO meeting_response VALUES ('meeting-vote-1','Sam','other')").run()).rejects.toThrow(/UNIQUE constraint/);
  });
});
