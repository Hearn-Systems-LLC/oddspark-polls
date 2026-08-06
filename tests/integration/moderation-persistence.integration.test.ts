import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createModerationPersistence,
  createPollPersistence,
} from "../../src/adapters/d1/index";
import {
  DISCOVERY_STATES,
  type PollId,
  type UserId,
} from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };

const testEnv = env as MigrationTestEnv;
const OWNER = "moderation-owner" as UserId;
const ADMINISTRATOR = "moderation-administrator";
const CREATOR = "moderation-creator";
const NOW = 1_800_000_000_000;

function pollId(suffix: string): PollId {
  return `moderation-poll-${suffix}` as PollId;
}

async function insertUser(id: string, role = "creator"): Promise<void> {
  await testEnv.DB.prepare(
    `INSERT INTO user
      (id, name, email, email_verified, created_at, updated_at, role)
     VALUES (?1, 'Moderation Fixture', ?2, 1,
       '2026-08-04T00:00:00.000Z', '2026-08-04T00:00:00.000Z', ?3)`,
  )
    .bind(id, `${id}@example.test`, role)
    .run();
}

async function insertPoll(
  id: PollId,
  discoveryState: "unlisted" | "listed" | "delisted",
): Promise<void> {
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO poll (
        id, owner_user_id, poll_type, question, description,
        result_visibility, discovery_state, session_checks_enabled,
        ip_checks_enabled, voter_codes_enabled, captcha_enabled,
        vpn_blocking_enabled, multi_select_enabled, min_selections,
        max_selections, deadline_ms, closed_at_ms, representation_version,
        created_at_ms, updated_at_ms
      ) VALUES (
        ?1, ?2, 'multiple_choice', 'Protected question?',
        'Protected description', 'after_close', ?3, 1, 1, 1, 1, 1,
        1, 1, 2, ?4, NULL, 7, ?5, ?5
      )`,
    ).bind(id, OWNER, discoveryState, NOW + 60_000, NOW - 1_000),
    testEnv.DB.prepare(
      `INSERT INTO poll_reference
        (reference, poll_id, kind, is_canonical, created_at_ms)
       VALUES (?1, ?2, 'custom', 1, ?3)`,
    ).bind(`canonical-${id}`, id, NOW - 1_000),
    testEnv.DB.prepare(
      `INSERT INTO poll_reference
        (reference, poll_id, kind, is_canonical, created_at_ms)
       VALUES (?1, ?2, 'generated', 0, ?3)`,
    ).bind(`alias-${id}`, id, NOW - 2_000),
    testEnv.DB.prepare(
      `INSERT INTO poll_option (id, poll_id, label, position, created_at_ms)
       VALUES (?1, ?2, 'Protected option', 0, ?3)`,
    ).bind(`option-${id}`, id, NOW - 1_000),
  ]);
}

async function revision(): Promise<number> {
  const row = await testEnv.DB.prepare(
    "SELECT revision FROM discovery_catalog_revision WHERE singleton = 1",
  ).first<{ revision: number }>();
  if (!row) throw new Error("missing discovery revision");
  return row.revision;
}

async function pollState(id: PollId): Promise<{
  discovery_state: string;
  updated_at_ms: number;
  representation_version: number;
}> {
  const row = await testEnv.DB.prepare(
    `SELECT discovery_state, updated_at_ms, representation_version
     FROM poll WHERE id = ?1`,
  )
    .bind(id)
    .first<{
      discovery_state: string;
      updated_at_ms: number;
      representation_version: number;
    }>();
  if (!row) throw new Error("missing Poll fixture");
  return row;
}

async function actions(id: PollId) {
  return (
    await testEnv.DB.prepare(
      `SELECT sequence, actor_user_id, action, prior_state, next_state,
              created_at_ms
       FROM moderation_action WHERE poll_id = ?1 ORDER BY sequence`,
    )
      .bind(id)
      .all<{
        sequence: number;
        actor_user_id: string;
        action: string;
        prior_state: string;
        next_state: string;
        created_at_ms: number;
      }>()
  ).results;
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DROP TRIGGER IF EXISTS test_fail_moderation").run();
  await testEnv.DB.prepare("DELETE FROM moderation_action").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("DELETE FROM account").run();
  await testEnv.DB.prepare("DELETE FROM session").run();
  await testEnv.DB.prepare("DELETE FROM user").run();
  await testEnv.DB.prepare(
    "UPDATE discovery_catalog_revision SET revision = 1 WHERE singleton = 1",
  ).run();
  await insertUser(OWNER);
  await insertUser(ADMINISTRATOR, "administrator");
  await insertUser(CREATOR);
});

describe("Administrator moderation D1 transaction", () => {
  it("resolves an alias to one minimal canonical moderation target", async () => {
    const id = pollId("lookup");
    await insertPoll(id, "listed");

    const target = await createModerationPersistence(
      testEnv.DB,
    ).findTargetByReference(`alias-${id}`);

    expect(target).toEqual({
      pollId: id,
      question: "Protected question?",
      canonicalReference: `canonical-${id}`,
      discoveryState: "listed",
      deadlineMs: NOW + 60_000,
      closedAtMs: null,
    });
    expect(Object.keys(target ?? {}).sort()).toEqual([
      "canonicalReference",
      "closedAtMs",
      "deadlineMs",
      "discoveryState",
      "pollId",
      "question",
    ]);
    expect(
      await createModerationPersistence(testEnv.DB).findTargetByReference(
        `ALIAS-${id}`,
      ),
    ).toBeNull();
  });

  it.each([
    {
      field: "question",
      corrupt: (id: PollId) =>
        testEnv.DB.prepare("UPDATE poll SET question = '' WHERE id = ?1")
          .bind(id)
          .run(),
    },
    {
      field: "canonical reference",
      corrupt: (id: PollId) =>
        testEnv.DB.prepare(
          "UPDATE poll_reference SET reference = '' WHERE poll_id = ?1 AND is_canonical = 1",
        )
          .bind(id)
          .run(),
    },
  ])("rejects an empty persisted $field", async ({ field: _field, corrupt }) => {
    const id = pollId(`empty-${_field.replace(" ", "-")}`);
    await insertPoll(id, "listed");
    await corrupt(id);

    await expect(
      createModerationPersistence(testEnv.DB).findTargetByReference(
        `alias-${id}`,
      ),
    ).rejects.toThrow("Malformed moderation target projection");
  });

  it.each(["listed", "unlisted"] as const)(
    "captures and restores the immediately prior %s state in sequence order",
    async (priorState) => {
      const id = pollId(priorState);
      await insertPoll(id, priorState);
      const persistence = createModerationPersistence(testEnv.DB);
      const initialRevision = await revision();

      expect(
        await persistence.applyModeration({
          actorUserId: ADMINISTRATOR,
          pollId: id,
          intent: "delist",
          updatedAtMs: NOW,
        }),
      ).toBe("updated");
      expect(await pollState(id)).toEqual({
        discovery_state: "delisted",
        updated_at_ms: NOW,
        representation_version: 7,
      });
      expect(await revision()).toBe(initialRevision + 1);

      expect(
        await persistence.applyModeration({
          actorUserId: ADMINISTRATOR,
          pollId: id,
          intent: "clear_delisted",
          updatedAtMs: NOW,
        }),
      ).toBe("updated");
      expect(await pollState(id)).toEqual({
        discovery_state: priorState,
        updated_at_ms: NOW,
        representation_version: 7,
      });
      expect(await revision()).toBe(initialRevision + 2);
      expect(await actions(id)).toEqual([
        {
          sequence: expect.any(Number),
          actor_user_id: ADMINISTRATOR,
          action: "delist",
          prior_state: priorState,
          next_state: "delisted",
          created_at_ms: NOW,
        },
        {
          sequence: expect.any(Number),
          actor_user_id: ADMINISTRATOR,
          action: "clear_delisted",
          prior_state: "delisted",
          next_state: priorState,
          created_at_ms: NOW,
        },
      ]);
    },
  );

  it("orders repeated same-timestamp cycles and restores each immediately prior choice", async () => {
    const id = pollId("cycles");
    await insertPoll(id, "listed");
    const moderation = createModerationPersistence(testEnv.DB);
    const polls = createPollPersistence(testEnv.DB);

    await moderation.applyModeration({
      actorUserId: ADMINISTRATOR,
      pollId: id,
      intent: "delist",
      updatedAtMs: NOW,
    });
    await moderation.applyModeration({
      actorUserId: ADMINISTRATOR,
      pollId: id,
      intent: "clear_delisted",
      updatedAtMs: NOW,
    });
    expect(
      await polls.updateListingForOwner({
        pollId: id,
        ownerUserId: OWNER,
        state: "unlisted",
        updatedAtMs: NOW,
      }),
    ).toBe("updated");
    await moderation.applyModeration({
      actorUserId: ADMINISTRATOR,
      pollId: id,
      intent: "delist",
      updatedAtMs: NOW,
    });
    await moderation.applyModeration({
      actorUserId: ADMINISTRATOR,
      pollId: id,
      intent: "clear_delisted",
      updatedAtMs: NOW,
    });

    expect((await pollState(id)).discovery_state).toBe("unlisted");
    const rows = await actions(id);
    expect(rows.map((row) => row.action)).toEqual([
      "delist",
      "clear_delisted",
      "delist",
      "clear_delisted",
    ]);
    expect(rows.map((row) => row.created_at_ms)).toEqual([
      NOW,
      NOW,
      NOW,
      NOW,
    ]);
    expect(rows.map((row) => row.sequence)).toEqual(
      rows.map((row) => row.sequence).toSorted((left, right) => left - right),
    );
    expect(rows.at(-2)?.prior_state).toBe("unlisted");
    expect(rows.at(-1)?.next_state).toBe("unlisted");
  });

  it("clears a legacy Delisted row without usable history to Unlisted", async () => {
    const id = pollId("legacy");
    await insertPoll(id, "delisted");

    expect(
      await createModerationPersistence(testEnv.DB).applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "clear_delisted",
        updatedAtMs: NOW,
      }),
    ).toBe("updated");

    expect((await pollState(id)).discovery_state).toBe("unlisted");
    expect(await actions(id)).toEqual([
      expect.objectContaining({
        action: "clear_delisted",
        prior_state: "delisted",
        next_state: "unlisted",
      }),
    ]);
  });

  it("makes repeated delist idempotent and non-Delisted clear invalid without churn", async () => {
    const id = pollId("noops");
    await insertPoll(id, "listed");
    const persistence = createModerationPersistence(testEnv.DB);
    await persistence.applyModeration({
      actorUserId: ADMINISTRATOR,
      pollId: id,
      intent: "delist",
      updatedAtMs: NOW,
    });
    const afterTransition = await pollState(id);
    const afterRevision = await revision();

    expect(
      await persistence.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "delist",
        updatedAtMs: NOW + 1,
      }),
    ).toBe("unchanged");
    expect(await pollState(id)).toEqual(afterTransition);
    expect(await revision()).toBe(afterRevision);
    expect(await actions(id)).toHaveLength(1);

    await persistence.applyModeration({
      actorUserId: ADMINISTRATOR,
      pollId: id,
      intent: "clear_delisted",
      updatedAtMs: NOW + 2,
    });
    const afterClear = await pollState(id);
    const afterClearRevision = await revision();
    expect(
      await persistence.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "clear_delisted",
        updatedAtMs: NOW + 3,
      }),
    ).toBe("invalid_transition");
    expect(await pollState(id)).toEqual(afterClear);
    expect(await revision()).toBe(afterClearRevision);
    expect(await actions(id)).toHaveLength(2);
  });

  it("classifies a future recognized state as invalid without writing", async () => {
    const id = pollId("future-state");
    await insertPoll(id, "listed");
    await testEnv.DB.prepare(
      "UPDATE poll SET discovery_state = 'archived' WHERE id = ?1",
    )
      .bind(id)
      .run();
    const before = await pollState(id);
    const beforeRevision = await revision();
    expect(
      await createModerationPersistence(testEnv.DB, [
        ...DISCOVERY_STATES,
        "archived",
      ]).applyModeration({
          actorUserId: ADMINISTRATOR,
          pollId: id,
          intent: "delist",
          updatedAtMs: NOW,
      }),
    ).toBe("invalid_transition");
    expect(await pollState(id)).toEqual(before);
    expect(await actions(id)).toHaveLength(0);
    expect(await revision()).toBe(beforeRevision);
  });

  it("checks the live role before target classification or mutation", async () => {
    const existing = pollId("revoked");
    await insertPoll(existing, "listed");
    await testEnv.DB.prepare(
      "UPDATE user SET role = 'creator' WHERE id = ?1",
    )
      .bind(ADMINISTRATOR)
      .run();
    const persistence = createModerationPersistence(testEnv.DB);

    expect(
      await persistence.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: existing,
        intent: "delist",
        updatedAtMs: NOW,
      }),
    ).toBe("authorization_denied");
    expect(
      await persistence.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: pollId("missing"),
        intent: "delist",
        updatedAtMs: NOW,
      }),
    ).toBe("authorization_denied");
    expect((await pollState(existing)).discovery_state).toBe("listed");
    expect(await actions(existing)).toHaveLength(0);
  });

  it("returns not-found only to a live Administrator", async () => {
    expect(
      await createModerationPersistence(testEnv.DB).applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: pollId("missing"),
        intent: "delist",
        updatedAtMs: NOW,
      }),
    ).toBe("not_found");
  });

  it("serializes an owner listing race without letting the owner overwrite Delisted", async () => {
    const id = pollId("race");
    await insertPoll(id, "listed");
    const moderation = createModerationPersistence(testEnv.DB);
    const polls = createPollPersistence(testEnv.DB);

    const [moderationResult, ownerResult] = await Promise.all([
      moderation.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "delist",
        updatedAtMs: NOW,
      }),
      polls.updateListingForOwner({
        pollId: id,
        ownerUserId: OWNER,
        state: "unlisted",
        updatedAtMs: NOW,
      }),
    ]);

    expect(moderationResult).toBe("updated");
    expect(["updated", "delisted"]).toContain(ownerResult);
    expect((await pollState(id)).discovery_state).toBe("delisted");
    expect((await actions(id))[0]?.prior_state).toMatch(/^(listed|unlisted)$/u);
  });

  it("serializes duplicate Administrator commands to one transition per cycle", async () => {
    const id = pollId("duplicates");
    await insertPoll(id, "listed");
    const persistence = createModerationPersistence(testEnv.DB);
    const beforeRevision = await revision();

    const delistResults = await Promise.all([
      persistence.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "delist",
        updatedAtMs: NOW,
      }),
      persistence.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "delist",
        updatedAtMs: NOW + 1,
      }),
    ]);
    expect(delistResults.toSorted()).toEqual(["unchanged", "updated"]);
    expect(await actions(id)).toHaveLength(1);
    expect(await revision()).toBe(beforeRevision + 1);

    const clearResults = await Promise.all([
      persistence.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "clear_delisted",
        updatedAtMs: NOW + 2,
      }),
      persistence.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "clear_delisted",
        updatedAtMs: NOW + 3,
      }),
    ]);
    expect(clearResults.toSorted()).toEqual([
      "invalid_transition",
      "updated",
    ]);
    expect((await pollState(id)).discovery_state).toBe("listed");
    expect(await actions(id)).toHaveLength(2);
    expect(await revision()).toBe(beforeRevision + 2);
  });

  it("rolls the action, state, and catalog revision back when a batch statement fails", async () => {
    const id = pollId("rollback");
    await insertPoll(id, "listed");
    const beforeRevision = await revision();
    await testEnv.DB.prepare(
      `CREATE TRIGGER test_fail_moderation
       BEFORE UPDATE OF discovery_state ON poll
       WHEN NEW.discovery_state = 'delisted'
       BEGIN
         SELECT RAISE(ABORT, 'forced_moderation_failure');
       END`,
    ).run();

    await expect(
      createModerationPersistence(testEnv.DB).applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "delist",
        updatedAtMs: NOW,
      }),
    ).rejects.toThrow();

    expect((await pollState(id)).discovery_state).toBe("listed");
    expect(await actions(id)).toHaveLength(0);
    expect(await revision()).toBe(beforeRevision);
  });
});

describe("Administrator moderation protected facts", () => {
  it("changes only Discovery state, timestamp, audit, and catalog revision through clear", async () => {
    const id = pollId("protected");
    await insertPoll(id, "listed");
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        `INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms)
         VALUES ('protected-vote', ?1, 'protected-submission', 'protected-hash', ?2)`,
      ).bind(id, NOW - 500),
      testEnv.DB.prepare(
        `INSERT INTO vote_selection (vote_id, poll_option_id)
         VALUES ('protected-vote', ?1)`,
      ).bind(`option-${id}`),
      testEnv.DB.prepare(
        `INSERT INTO voter_claim
          (poll_id, check_kind, digest, vote_id, created_at_ms)
         VALUES (?1, 'session', 'protected-digest', 'protected-vote', ?2)`,
      ).bind(id, NOW - 500),
    ]);
    const readProtectedPollFacts = () =>
      testEnv.DB.prepare(
        `SELECT owner_user_id, poll_type, question, description,
                result_visibility, session_checks_enabled, ip_checks_enabled,
                voter_codes_enabled, captcha_enabled, vpn_blocking_enabled,
                multi_select_enabled, min_selections, max_selections,
                deadline_ms, closed_at_ms, representation_version, created_at_ms
         FROM poll WHERE id = ?1`,
      )
        .bind(id)
        .first();
    const readRelatedFacts = async () => ({
      references: (
        await testEnv.DB.prepare(
          "SELECT * FROM poll_reference WHERE poll_id = ?1 ORDER BY reference",
        )
          .bind(id)
          .all()
      ).results,
      options: (
        await testEnv.DB.prepare("SELECT * FROM poll_option WHERE poll_id = ?1")
          .bind(id)
          .all()
      ).results,
      votes: (
        await testEnv.DB.prepare("SELECT * FROM vote WHERE poll_id = ?1")
          .bind(id)
          .all()
      ).results,
      selections: (
        await testEnv.DB.prepare(
          "SELECT * FROM vote_selection WHERE vote_id = 'protected-vote'",
        ).all()
      ).results,
      claims: (
        await testEnv.DB.prepare("SELECT * FROM voter_claim WHERE poll_id = ?1")
          .bind(id)
          .all()
      ).results,
    });
    const protectedBefore = await readProtectedPollFacts();
    const relatedBefore = await readRelatedFacts();
    const revisionBefore = await revision();
    const persistence = createModerationPersistence(testEnv.DB);

    expect(
      await persistence.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "delist",
        updatedAtMs: NOW,
      }),
    ).toBe("updated");

    expect(await readProtectedPollFacts()).toEqual(protectedBefore);
    expect(await readRelatedFacts()).toEqual(relatedBefore);
    expect(await pollState(id)).toEqual({
      discovery_state: "delisted",
      updated_at_ms: NOW,
      representation_version: 7,
    });
    expect(await revision()).toBe(revisionBefore + 1);
    expect(await actions(id)).toEqual([
      {
        sequence: expect.any(Number),
        actor_user_id: ADMINISTRATOR,
        action: "delist",
        prior_state: "listed",
        next_state: "delisted",
        created_at_ms: NOW,
      },
    ]);

    expect(
      await persistence.applyModeration({
        actorUserId: ADMINISTRATOR,
        pollId: id,
        intent: "clear_delisted",
        updatedAtMs: NOW + 1,
      }),
    ).toBe("updated");

    expect(await readProtectedPollFacts()).toEqual(protectedBefore);
    expect(await readRelatedFacts()).toEqual(relatedBefore);
    expect(await pollState(id)).toEqual({
      discovery_state: "listed",
      updated_at_ms: NOW + 1,
      representation_version: 7,
    });
    expect(await revision()).toBe(revisionBefore + 2);
    expect(await actions(id)).toEqual([
      {
        sequence: expect.any(Number),
        actor_user_id: ADMINISTRATOR,
        action: "delist",
        prior_state: "listed",
        next_state: "delisted",
        created_at_ms: NOW,
      },
      {
        sequence: expect.any(Number),
        actor_user_id: ADMINISTRATOR,
        action: "clear_delisted",
        prior_state: "delisted",
        next_state: "listed",
        created_at_ms: NOW + 1,
      },
    ]);
  });
});
