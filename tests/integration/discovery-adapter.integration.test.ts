import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createPollPersistence } from "../../src/adapters/d1/index";
import type { PollPersistenceRows } from "../../src/modules/polls/index";
import type {
  DiscoveryState,
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
const NOW = 1_784_000_000_000;
const OWNER_A = "owner-a" as UserId;
const OWNER_B = "owner-b" as UserId;
const POLL_ID = "poll-discovery" as PollId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('owner-a', 'Creator A', 'owner-a@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).run();
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES ('owner-b', 'Creator B', 'owner-b@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
  ).run();
});

function pollRows(): PollPersistenceRows {
  return {
    poll: {
      id: POLL_ID,
      ownerUserId: OWNER_A,
      pollType: "multiple_choice",
      question: "Where should we go?",
      description: null,
      resultVisibility: "live",
      discoveryState: "unlisted",
      sessionChecksEnabled: true,
      ipChecksEnabled: false,
      voterCodesEnabled: false,
      captchaEnabled: false,
      vpnBlockingEnabled: false,
      multiSelectEnabled: false,
      minSelections: null,
      maxSelections: null,
      deadlineMs: null,
      representationVersion: 1,
      createdAtMs: NOW,
    },
    options: [
      {
        id: "poll-discovery-option" as PollOptionId,
        pollId: POLL_ID,
        label: "The park",
        position: 0,
        createdAtMs: NOW,
      },
    ],
    reference: {
      reference: "poll-discovery-ref",
      pollId: POLL_ID,
      kind: "generated",
      createdAtMs: NOW,
    },
  };
}

async function storedState(): Promise<{
  state: DiscoveryState;
  version: number;
  updatedAtMs: number;
}> {
  const row = await testEnv.DB.prepare(
    "SELECT discovery_state AS state, representation_version AS version, updated_at_ms AS updatedAtMs FROM poll WHERE id = ?1",
  )
    .bind(POLL_ID)
    .first<{
      state: DiscoveryState;
      version: number;
      updatedAtMs: number;
    }>();
  if (!row) throw new Error("missing discovery fixture");
  return row;
}

describe("discovery D1 adapter", () => {
  it("persists both listing directions without bumping representation version", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows());

    await expect(
      persistence.updateListingForOwner({
        pollId: POLL_ID,
        ownerUserId: OWNER_A,
        state: "listed",
        updatedAtMs: NOW + 100,
      }),
    ).resolves.toBe("updated");
    expect(await storedState()).toEqual({
      state: "listed",
      version: 1,
      updatedAtMs: NOW + 100,
    });

    await expect(
      persistence.updateListingForOwner({
        pollId: POLL_ID,
        ownerUserId: OWNER_A,
        state: "unlisted",
        updatedAtMs: NOW + 200,
      }),
    ).resolves.toBe("updated");
    expect(await storedState()).toEqual({
      state: "unlisted",
      version: 1,
      updatedAtMs: NOW + 200,
    });
  });

  it("classifies an unchanged request without touching updated_at_ms", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows());

    await expect(
      persistence.updateListingForOwner({
        pollId: POLL_ID,
        ownerUserId: OWNER_A,
        state: "unlisted",
        updatedAtMs: NOW + 500,
      }),
    ).resolves.toBe("unchanged");
    expect(await storedState()).toEqual({
      state: "unlisted",
      version: 1,
      updatedAtMs: NOW,
    });
  });

  it("conceals a foreign owner as not_found", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows());

    await expect(
      persistence.updateListingForOwner({
        pollId: POLL_ID,
        ownerUserId: OWNER_B,
        state: "listed",
        updatedAtMs: NOW + 100,
      }),
    ).resolves.toBe("not_found");
    expect((await storedState()).state).toBe("unlisted");
  });

  it("classifies a delisted race and leaves the row unchanged", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows());
    await testEnv.DB.prepare(
      "UPDATE poll SET discovery_state = 'delisted' WHERE id = ?1",
    )
      .bind(POLL_ID)
      .run();

    await expect(
      persistence.updateListingForOwner({
        pollId: POLL_ID,
        ownerUserId: OWNER_A,
        state: "listed",
        updatedAtMs: NOW + 100,
      }),
    ).resolves.toBe("delisted");
    expect(await storedState()).toEqual({
      state: "delisted",
      version: 1,
      updatedAtMs: NOW,
    });
  });

  it("round-trips discovery state through lifecycle and dashboard reads", async () => {
    const persistence = createPollPersistence(testEnv.DB);
    await persistence.insertPoll(pollRows());
    await persistence.updateListingForOwner({
      pollId: POLL_ID,
      ownerUserId: OWNER_A,
      state: "listed",
      updatedAtMs: NOW + 100,
    });

    const lifecycle = await persistence.loadLifecycleForOwner(POLL_ID, OWNER_A);
    expect(lifecycle?.discoveryState).toBe("listed");
    const list = await persistence.listPollsForOwner(OWNER_A, NOW);
    expect(list).toHaveLength(1);
    expect(list[0]?.discoveryState).toBe("listed");
  });
});
