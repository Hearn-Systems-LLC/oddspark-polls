import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { createVotePersistence } from "../../src/adapters/d1/index";
import type { RequestContext } from "../../src/lib/request-context";
import type { VotePersistenceBatch } from "../../src/modules/voting/index";
import { asVoterClaimDigest } from "../../src/modules/voting/ip-address";
import { incrementRepresentationVersion } from "../../src/shared/application/index";
import type {
  PollId,
  PollOptionId,
  UserId,
} from "../../src/shared/domain/index";
import {
  ALL,
  GET,
  HEAD,
} from "../../src/pages/[reference]/results/live";

function fixtureDigest(seed: string) {
  let out = "";
  for (let i = 0; i < 64; i += 1) {
    out += (seed.charCodeAt(i % seed.length) % 16).toString(16);
  }
  const branded = asVoterClaimDigest(out);
  if (branded === null) throw new Error("fixture digest construction failed");
  return branded;
}

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as MigrationTestEnv;
type RouteContext = Parameters<typeof GET>[0];

const OWNER_ID = "live-route-owner" as UserId;
const OTHER_ID = "live-route-other" as UserId;
const POLL_ID = "live-route-poll" as PollId;
const OPTION_A = `${POLL_ID}-option-a` as PollOptionId;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("DELETE FROM session").run();
  await testEnv.DB.prepare("DELETE FROM account").run();
  await testEnv.DB.prepare("DELETE FROM verification").run();
  await testEnv.DB.prepare("DELETE FROM user").run();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Owner', 'live-route-owner@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
    ).bind(OWNER_ID),
    testEnv.DB.prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Other', 'live-route-other@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
    ).bind(OTHER_ID),
  ]);
});

async function seedPoll(
  overrides: {
    pollId?: PollId;
    reference?: string;
    resultVisibility?: "live" | "after_close" | "creator_only";
    deadlineMs?: number | null;
  } = {},
): Promise<{ pollId: PollId; reference: string }> {
  const pollId = overrides.pollId ?? POLL_ID;
  const reference = overrides.reference ?? "live-route-ref";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, session_checks_enabled, multi_select_enabled, min_selections, max_selections, deadline_ms, closed_at_ms, representation_version, created_at_ms, updated_at_ms) VALUES (?1, ?2, 'multiple_choice', 'Choose live', ?3, 1, 0, NULL, NULL, ?4, NULL, 1, 0, 0)",
    ).bind(
      pollId,
      OWNER_ID,
      overrides.resultVisibility ?? "live",
      overrides.deadlineMs ?? null,
    ),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Alpha', 0, 0)",
    ).bind(`${pollId}-option-a`, pollId),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Beta', 1, 0)",
    ).bind(`${pollId}-option-b`, pollId),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'generated', 1, 0)",
    ).bind(reference, pollId),
  ]);
  return { pollId, reference };
}

function requestContext(): RequestContext {
  return {
    requestId: "live-route-request",
    startedAtMs: Date.now(),
    principal: null,
    csrfToken: null,
    pollId: null,
    sessionExpired: false,
    sessionLookupFailed: false,
    csrfRejected: false,
    authorizationDenied: false,
    resultsLookupFailed: false,
    voteRejection: false,
    providerOutcome: "none",
  };
}

function makeContext(
  reference: string,
  options: {
    method?: string;
    ifNoneMatch?: string;
    userId?: UserId | null;
  } = {},
): { context: RouteContext; trace: RequestContext } {
  const trace = requestContext();
  const headers = new Headers();
  if (options.ifNoneMatch) {
    headers.set("if-none-match", options.ifNoneMatch);
  }
  const context = {
    request: new Request(
      `https://polls.example.test/${reference}/results/live`,
      { method: options.method ?? "GET", headers },
    ),
    params: { reference },
    locals: {
      principal:
        options.userId === undefined || options.userId === null
          ? null
          : { userId: options.userId },
      requestContext: trace,
    },
  } as unknown as RouteContext;
  return { context, trace };
}

function expectPrivateNoStore(response: Response): void {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
}

async function castAcceptedVote(): Promise<void> {
  const batch: VotePersistenceBatch = {
    vote: {
      id: "live-route-vote",
      pollId: POLL_ID,
      submissionId: "live-route-submission",
      payloadHash: "live-route-hash",
      createdAtMs: Date.now(),
    },
    contributions: [
      {
        kind: "vote_selection",
        voteId: "live-route-vote",
        pollOptionId: OPTION_A,
      },
      {
        kind: "voter_claim",
        pollId: POLL_ID,
        checkKind: "session",
        digest: fixtureDigest("live-route-digest"),
        voteId: "live-route-vote",
        createdAtMs: Date.now(),
      },
    ],
    representationVersion: incrementRepresentationVersion(POLL_ID, Date.now()),
  };
  await createVotePersistence(testEnv.DB).insertVote(batch);
}

describe("live Results endpoint", () => {
  it.each(["POST", "PUT", "DELETE", "PATCH"])(
    "rejects %s with 405 and Allow before any Poll read",
    async (method) => {
      const { context, trace } = makeContext("never-existed", { method });
      const response = await ALL(context);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("GET, HEAD");
      expectPrivateNoStore(response);
      expect(trace.pollId).toBeNull();
    },
  );

  it("returns a plain 404 for unknown and mixed-case generated references", async () => {
    await seedPoll({ reference: "GenRef-AbC123-xYz_9" });
    for (const reference of ["never-existed", "genref-abc123-xyz_9"]) {
      const { context, trace } = makeContext(reference);
      const response = await GET(context);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("Not found.");
      expect(response.headers.get("etag")).toBeNull();
      expectPrivateNoStore(response);
      expect(trace.pollId).toBeNull();
    }
  });

  it("returns a versioned Results-owned JSON projection and supports HEAD", async () => {
    const { reference } = await seedPoll();
    const getContext = makeContext(reference);
    const response = await GET(getContext.context);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1:open"');
    expectPrivateNoStore(response);
    await expect(response.json()).resolves.toEqual({
      multiSelectEnabled: false,
      options: [
        {
          id: `${POLL_ID}-option-a`,
          label: "Alpha",
          position: 0,
          count: 0,
          percent: 0,
          pieShare: 0,
          leading: false,
        },
        {
          id: `${POLL_ID}-option-b`,
          label: "Beta",
          position: 1,
          count: 0,
          percent: 0,
          pieShare: 0,
          leading: false,
        },
      ],
      voterCount: 0,
      selectionCount: 0,
      tied: false,
      empty: true,
      status: "open",
    });
    expect(getContext.trace.pollId).toBe(POLL_ID);

    const headContext = makeContext(reference, { method: "HEAD" });
    const headResponse = await HEAD(headContext.context);
    expect(headResponse.status).toBe(200);
    expect(headResponse.headers.get("etag")).toBe('"1:open"');
    expect(await headResponse.text()).toBe("");
    expectPrivateNoStore(headResponse);
    expect(headContext.trace.pollId).toBe(POLL_ID);
  });

  it("returns 304 on a matching validator and a new 200 snapshot after a Vote", async () => {
    const { reference } = await seedPoll();
    const matching = makeContext(reference, { ifNoneMatch: '"1:open"' });
    const unchanged = await GET(matching.context);
    expect(unchanged.status).toBe(304);
    expect(unchanged.headers.get("etag")).toBe('"1:open"');
    expect(await unchanged.text()).toBe("");
    expectPrivateNoStore(unchanged);
    expect(matching.trace.pollId).toBe(POLL_ID);

    await castAcceptedVote();
    const changed = await GET(
      makeContext(reference, { ifNoneMatch: '"1:open"' }).context,
    );
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).toBe('"2:open"');
    expectPrivateNoStore(changed);
    const payload = (await changed.json()) as {
      voterCount: number;
      selectionCount: number;
      empty: boolean;
      status: string;
      options: {
        id: string;
        count: number;
        percent: number;
        pieShare: number;
      }[];
    };
    expect(payload).toMatchObject({
      voterCount: 1,
      selectionCount: 1,
      empty: false,
      status: "open",
    });
    expect(payload.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `${POLL_ID}-option-a`,
          count: 1,
          percent: 100,
          pieShare: 1,
        }),
      ]),
    );
  });

  it("changes the validator when only effective Deadline status crosses closed", async () => {
    const { reference } = await seedPoll({ deadlineMs: Date.now() - 1 });
    const response = await GET(
      makeContext(reference, { ifNoneMatch: '"1:open"' }).context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1:closed"');
    expectPrivateNoStore(response);
    await expect(response.json()).resolves.toMatchObject({ status: "closed" });
  });

  it.each([
    {
      name: "open After Close for an anonymous viewer",
      visibility: "after_close" as const,
      userId: null,
    },
    {
      name: "open After Close for a signed-in viewer",
      visibility: "after_close" as const,
      userId: OTHER_ID,
    },
    {
      name: "Creator-Only for a non-owner",
      visibility: "creator_only" as const,
      userId: OTHER_ID,
    },
  ])("returns a byte-empty validator-free 204 for $name", async ({
    visibility,
    userId,
  }) => {
    const { reference } = await seedPoll({
      resultVisibility: visibility,
      deadlineMs:
        visibility === "after_close" ? Date.now() + 60_000 : null,
    });
    const { context, trace } = makeContext(reference, { userId });
    const response = await GET(context);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect(response.headers.get("etag")).toBeNull();
    expect(response.headers.get("last-modified")).toBeNull();
    expectPrivateNoStore(response);
    expect(trace.pollId).toBe(POLL_ID);
  });

  it("returns Creator-Only Results to the owning Creator", async () => {
    const { reference } = await seedPoll({
      resultVisibility: "creator_only",
    });
    const { context, trace } = makeContext(reference, { userId: OWNER_ID });
    const response = await GET(context);
    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe('"1:open"');
    expectPrivateNoStore(response);
    expect(trace.pollId).toBe(POLL_ID);
  });
});
