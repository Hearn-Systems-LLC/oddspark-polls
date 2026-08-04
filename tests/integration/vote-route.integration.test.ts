import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVoteDigest } from "../../src/adapters/digest/index";
import { createModerationPersistence } from "../../src/adapters/d1/index";
import { onRequest } from "../../src/middleware";
import { moderatePollDiscovery } from "../../src/modules/discovery/index";
import PollReferencePage from "../../src/pages/[reference].astro";
import type { PollId, PollOptionId, UserId } from "../../src/shared/domain/index";

type MigrationTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
  VOTE_DIGEST_SECRET: string;
};

const testEnv = env as MigrationTestEnv;
const OWNER = "vote-route-owner" as UserId;
const ADMINISTRATOR = "vote-route-administrator" as UserId;

type MiddlewareContext = Parameters<typeof onRequest>[0];

function makeContext(request: Request): MiddlewareContext {
  return { request, locals: {} } as unknown as MiddlewareContext;
}

async function runVoteRoute(
  context: MiddlewareContext,
  reference: string,
): Promise<Response> {
  const container = await AstroContainer.create();
  return (await onRequest(
    context,
    (() =>
      container.renderToResponse(PollReferencePage, {
        request: context.request,
        params: { reference },
        locals: context.locals,
      })) as never,
  )) as Response;
}

async function seedPoll(options: {
  captchaEnabled?: boolean;
  ipChecksEnabled?: boolean;
  reference?: string;
  sessionChecksEnabled?: boolean;
}): Promise<{
  optionA: PollOptionId;
  optionB: PollOptionId;
  pollId: PollId;
  reference: string;
}> {
  const pollId = crypto.randomUUID() as PollId;
  const optionA = crypto.randomUUID() as PollOptionId;
  const optionB = crypto.randomUUID() as PollOptionId;
  const reference = options.reference ?? `vote-route-${crypto.randomUUID()}`;
  const nowMs = Date.now();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?1, 'Creator', 'vote-route@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')
       ON CONFLICT(id) DO NOTHING`,
    ).bind(OWNER),
    testEnv.DB.prepare(
      `INSERT INTO poll (
        id, owner_user_id, poll_type, question, result_visibility,
        session_checks_enabled, ip_checks_enabled, captcha_enabled, multi_select_enabled,
        min_selections, max_selections, deadline_ms, closed_at_ms,
        representation_version, created_at_ms, updated_at_ms
      ) VALUES (?1, ?2, 'multiple_choice', 'Route IP?', 'live', ?3, ?4, ?5, 0, NULL, NULL, NULL, NULL, 1, ?6, ?6)`,
    ).bind(
      pollId,
      OWNER,
      options.sessionChecksEnabled === false ? 0 : 1,
      options.ipChecksEnabled === true ? 1 : 0,
      options.captchaEnabled === true ? 1 : 0,
      nowMs,
    ),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Alpha', 0, ?3)",
    ).bind(optionA, pollId, nowMs),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Beta', 1, ?3)",
    ).bind(optionB, pollId, nowMs),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'custom', 1, ?3)",
    ).bind(reference, pollId, nowMs),
  ]);
  return { optionA, optionB, pollId, reference };
}

function formBody(
  optionId: string,
  submissionId = crypto.randomUUID(),
): URLSearchParams {
  return new URLSearchParams({
    submission_id: submissionId,
    option_id: optionId,
  });
}

function voteHeaders(
  extra: Record<string, string> = {},
  cookie = "",
): HeadersInit {
  return {
    "content-type": "application/x-www-form-urlencoded",
    origin: "https://polls.example.test",
    "sec-fetch-site": "same-origin",
    ...(cookie ? { cookie } : {}),
    ...extra,
  };
}

async function counts(pollId: string): Promise<{
  claims: number;
  selections: number;
  version: number | null;
  votes: number;
}> {
  const [votes, selections, claims, poll] = await Promise.all([
    testEnv.DB.prepare("SELECT COUNT(*) AS n FROM vote WHERE poll_id = ?1")
      .bind(pollId)
      .first<{ n: number }>(),
    testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM vote_selection WHERE vote_id IN (SELECT id FROM vote WHERE poll_id = ?1)",
    )
      .bind(pollId)
      .first<{ n: number }>(),
    testEnv.DB.prepare(
      "SELECT COUNT(*) AS n FROM voter_claim WHERE poll_id = ?1",
    )
      .bind(pollId)
      .first<{ n: number }>(),
    testEnv.DB.prepare(
      "SELECT representation_version AS v FROM poll WHERE id = ?1",
    )
      .bind(pollId)
      .first<{ v: number }>(),
  ]);
  return {
    votes: votes?.n ?? -1,
    selections: selections?.n ?? -1,
    claims: claims?.n ?? -1,
    version: poll?.v ?? null,
  };
}

async function moderate(
  pollId: PollId,
  intent: "delist" | "clear_delisted",
): Promise<void> {
  const result = await moderatePollDiscovery(
    {
      applyModeration: createModerationPersistence(testEnv.DB).applyModeration,
      nowMs: () => Date.now(),
    },
    { userId: ADMINISTRATOR, role: "administrator" },
    pollId,
    intent,
  );
  expect(result).toEqual({
    ok: true,
    value: { kind: "updated", intent },
  });
}

function stableMain(html: string): string {
  const main = html.match(/<main\b[\s\S]*<\/main>/)?.[0];
  if (!main) throw new Error("missing public main landmark");
  return main.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
    "[generated-id]",
  );
}

function voteDigestPurpose(data: BufferSource): string | null {
  const bytes =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return Array.isArray(parsed) && typeof parsed[1] === "string"
      ? parsed[1]
      : null;
  } catch {
    return null;
  }
}

function serializeConsoleCalls(
  ...spies: Array<{ mock: { calls: unknown[][] } }>
): string {
  return spies
    .flatMap((spy) => spy.mock.calls)
    .flat()
    .map((value) => {
      if (value instanceof Error) {
        return `${value.name}:${value.message}:${String(value.cause ?? "")}`;
      }
      if (typeof value === "string") {
        return value;
      }
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    })
    .join("\n");
}

function mockDigestSigning(
  handler: (
    purpose: string | null,
    sign: () => Promise<ArrayBuffer>,
  ) => Promise<ArrayBuffer>,
) {
  const realSign = crypto.subtle.sign.bind(crypto.subtle);
  return vi
    .spyOn(crypto.subtle, "sign")
    .mockImplementation(async (algorithm, key, data) =>
      handler(voteDigestPurpose(data), () => realSign(algorithm, key, data)),
    );
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  // Ensure digest secret is present for the route.
  if (
    typeof testEnv.VOTE_DIGEST_SECRET !== "string" ||
    testEnv.VOTE_DIGEST_SECRET.trim().length === 0
  ) {
    // Integration pool usually provisions this; fail closed if not.
    throw new Error("VOTE_DIGEST_SECRET missing in integration env");
  }
  await testEnv.DB.prepare(
    "INSERT OR IGNORE INTO user (id, name, email, email_verified, created_at, updated_at, role) VALUES (?1, 'Vote Route Administrator', 'vote-route-administrator@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z', 'administrator')",
  )
    .bind(ADMINISTRATOR)
    .run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const invalidIdentityCases: Array<{
  headers: Record<string, string>;
  label: string;
}> = [
  { label: "missing", headers: {} },
  {
    label: "malformed",
    headers: { "cf-connecting-ip": "203.0.113.4:443" },
  },
];

describe("administrator delisting public Vote contract", () => {
  it("keeps direct viewing and voting unchanged and privacy-safe while delisted", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      ipChecksEnabled: false,
    });
    await testEnv.DB.prepare(
      "UPDATE poll SET discovery_state = 'listed' WHERE id = ?1",
    )
      .bind(poll.pollId)
      .run();

    const initial = await runVoteRoute(
      makeContext(new Request(`https://polls.example.test/${poll.reference}`)),
      poll.reference,
    );
    const initialMain = stableMain(await initial.text());

    await moderate(poll.pollId, "delist");

    const delisted = await runVoteRoute(
      makeContext(new Request(`https://polls.example.test/${poll.reference}`)),
      poll.reference,
    );
    const delistedHtml = await delisted.text();
    const delistedMain = stableMain(delistedHtml);
    expect(delisted.status).toBe(200);
    expect(delisted.headers.get("x-robots-tag")).toBe("noindex");
    expect(delistedMain).toBe(initialMain);
    expect(delistedMain).toContain("Route IP?");
    expect(delistedMain).toContain("Alpha");
    expect(delistedMain).not.toContain(OWNER);
    expect(delistedMain).not.toContain(ADMINISTRATOR);
    expect(delistedMain).not.toMatch(
      /administrator|delisted|moderation|reason|appeal/iu,
    );

    const vote = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          method: "POST",
          headers: voteHeaders(),
          body: formBody(poll.optionA),
        }),
      ),
      poll.reference,
    );
    expect(vote.status).toBe(303);
    expect(await counts(poll.pollId)).toEqual({
      votes: 1,
      selections: 1,
      claims: 0,
      version: 2,
    });
    expect(
      await testEnv.DB.prepare(
        "SELECT discovery_state FROM poll WHERE id = ?1",
      )
        .bind(poll.pollId)
        .first<{ discovery_state: string }>(),
    ).toEqual({ discovery_state: "delisted" });

    await moderate(poll.pollId, "clear_delisted");
    expect(await counts(poll.pollId)).toEqual({
      votes: 1,
      selections: 1,
      claims: 0,
      version: 2,
    });
    expect(
      await testEnv.DB.prepare(
        "SELECT discovery_state FROM poll WHERE id = ?1",
      )
        .bind(poll.pollId)
        .first<{ discovery_state: string }>(),
    ).toEqual({ discovery_state: "listed" });
  });
});

describe("POST /:reference IP Checks delivery boundary", () => {
  it.each(invalidIdentityCases)(
    "returns 500 with no mutation when IP is on and identity is $label",
    async ({ headers }) => {
      const poll = await seedPoll({
        sessionChecksEnabled: false,
        ipChecksEnabled: true,
      });
      const context = makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          method: "POST",
          headers: voteHeaders(headers),
          body: formBody(poll.optionA),
        }),
      );

      const response = await runVoteRoute(context, poll.reference);

      expect(response.status).toBe(500);
      expect(await response.text()).toBe("Voting is unavailable.");
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(await counts(poll.pollId)).toEqual({
        votes: 0,
        selections: 0,
        claims: 0,
        version: 1,
      });
    },
  );

  it.each(invalidIdentityCases)(
    "accepts a Vote when IP is off and identity is $label",
    async ({ headers }) => {
      const poll = await seedPoll({
        sessionChecksEnabled: false,
        ipChecksEnabled: false,
      });
      const context = makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          method: "POST",
          headers: voteHeaders(headers),
          body: formBody(poll.optionA),
        }),
      );

      const response = await runVoteRoute(context, poll.reference);
      expect(response.status).toBe(303);
      expect(await counts(poll.pollId)).toEqual({
        votes: 1,
        selections: 1,
        claims: 0,
        version: 2,
      });
    },
  );

  it("keeps IP-claim digest failure private while rate-limit preparation still runs", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      ipChecksEnabled: true,
    });
    const rawAddress = "203.0.113.44";
    const injectedDigest = "d".repeat(64);
    const purposes: Array<string | null> = [];
    mockDigestSigning(async (purpose, sign) => {
      purposes.push(purpose);
      if (purpose === "ip") {
        throw new Error(
          `claim failed for raw=${rawAddress}; digest=${injectedDigest}`,
        );
      }
      return sign();
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          method: "POST",
          headers: voteHeaders({ "cf-connecting-ip": rawAddress }),
          body: formBody(poll.optionA),
        }),
      ),
      poll.reference,
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Voting is unavailable.");
    expect(purposes).toEqual(["ip", "rate_limit"]);
    expect(await counts(poll.pollId)).toEqual({
      votes: 0,
      selections: 0,
      claims: 0,
      version: 1,
    });
    const serialized = serializeConsoleCalls(log, error);
    expect(serialized).not.toContain(rawAddress);
    expect(serialized).not.toContain(injectedDigest);
    for (const forbiddenField of [
      "ipAddress",
      "ip_address",
      "clientIp",
      "cfConnectingIp",
      "ipDigest",
      "digest=",
      '"digest"',
    ]) {
      expect(serialized).not.toContain(forbiddenField);
    }
  });

  it("fails open only for rate-limit digest failure and preserves the IP claim", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      ipChecksEnabled: true,
    });
    const purposes: Array<string | null> = [];
    mockDigestSigning(async (purpose, sign) => {
      purposes.push(purpose);
      if (purpose === "rate_limit") {
        throw new Error("rate-limit digest unavailable");
      }
      return sign();
    });

    const response = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          method: "POST",
          headers: voteHeaders({ "cf-connecting-ip": "203.0.113.45" }),
          body: formBody(poll.optionA),
        }),
      ),
      poll.reference,
    );

    expect(response.status).toBe(303);
    expect(purposes).toEqual(["ip", "rate_limit", "session"]);
    expect(await counts(poll.pollId)).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("honors the authoritative IP toggle when it turns on after delivery", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      ipChecksEnabled: false,
    });
    const purposes: Array<string | null> = [];
    mockDigestSigning(async (purpose, sign) => {
      purposes.push(purpose);
      if (purpose === "ip") {
        throw new Error("delivery IP digest unavailable");
      }
      if (purpose === "rate_limit") {
        await testEnv.DB.prepare(
          "UPDATE poll SET ip_checks_enabled = 1 WHERE id = ?1",
        )
          .bind(poll.pollId)
          .run();
      }
      return sign();
    });

    const response = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          method: "POST",
          headers: voteHeaders({ "cf-connecting-ip": "203.0.113.46" }),
          body: formBody(poll.optionA),
        }),
      ),
      poll.reference,
    );

    expect(response.status).toBe(500);
    expect(await response.text()).toBe("Voting is unavailable.");
    expect(purposes).toEqual(["ip", "rate_limit"]);
    expect(await counts(poll.pollId)).toEqual({
      votes: 0,
      selections: 0,
      claims: 0,
      version: 1,
    });
    const stored = await testEnv.DB.prepare(
      "SELECT ip_checks_enabled AS enabled FROM poll WHERE id = ?1",
    )
      .bind(poll.pollId)
      .first<{ enabled: number }>();
    expect(stored?.enabled).toBe(1);
  });

  it("accepts the first Vote from an identity and 422s the second browser with IP copy", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      ipChecksEnabled: true,
    });
    const first = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "POST",
        headers: voteHeaders({ "cf-connecting-ip": "203.0.113.40" }),
        body: formBody(poll.optionA),
      }),
    );
    const firstResponse = await runVoteRoute(first, poll.reference);
    expect(firstResponse.status).toBe(303);

    const second = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "POST",
        headers: voteHeaders({ "cf-connecting-ip": "203.0.113.40" }),
        body: formBody(poll.optionB),
      }),
    );
    const secondResponse = await runVoteRoute(second, poll.reference);
    const html = await secondResponse.text();
    expect(secondResponse.status).toBe(422);
    expect(secondResponse.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain("Someone on this connection already voted.");
    expect(html).toContain("one-vote-per-network");
    expect(html).toContain("ask them to send you the results instead");
    expect(html).not.toContain("203.0.113.40");
    expect(html).not.toContain("You've already voted here.");
    expect(await counts(poll.pollId)).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });

    const digests = await testEnv.DB.prepare(
      "SELECT digest FROM voter_claim WHERE poll_id = ?1",
    )
      .bind(poll.pollId)
      .all<{ digest: string }>();
    expect(digests.results[0]?.digest).toMatch(/^[a-f0-9]{64}$/);
  });

  it("allows two browsers on one IP when only Session Checks are on", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: true,
      ipChecksEnabled: false,
    });
    const voterA = "aa".repeat(16);
    const voterB = "bb".repeat(16);

    const first = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "POST",
        headers: voteHeaders(
          { "cf-connecting-ip": "203.0.113.55" },
          `oddspark.voter=${voterA}`,
        ),
        body: formBody(poll.optionA),
      }),
    );
    expect((await runVoteRoute(first, poll.reference)).status).toBe(303);

    const second = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "POST",
        headers: voteHeaders(
          { "cf-connecting-ip": "203.0.113.55" },
          `oddspark.voter=${voterB}`,
        ),
        body: formBody(poll.optionB),
      }),
    );
    expect((await runVoteRoute(second, poll.reference)).status).toBe(303);
    expect(await counts(poll.pollId)).toEqual({
      votes: 2,
      selections: 2,
      claims: 2,
      version: 3,
    });
  });

  it.each(invalidIdentityCases)(
    "keeps GET and HEAD readable when network identity is $label",
    async ({ headers }) => {
      const poll = await seedPoll({
        sessionChecksEnabled: false,
        ipChecksEnabled: true,
      });
      const before = await counts(poll.pollId);

      const get = await runVoteRoute(
        makeContext(
          new Request(`https://polls.example.test/${poll.reference}`, {
            method: "GET",
            headers,
          }),
        ),
        poll.reference,
      );
      const html = await get.text();
      expect(get.status).toBe(200);
      expect(get.headers.get("cache-control")).toBe("private, no-store");
      expect(html).toContain("data-vote-form");
      expect(html).not.toContain('data-outcome-code="already_voted_ip"');
      expect(html).not.toContain("Someone on this connection already voted.");

      const head = await runVoteRoute(
        makeContext(
          new Request(`https://polls.example.test/${poll.reference}`, {
            method: "HEAD",
            headers,
          }),
        ),
        poll.reference,
      );
      expect(head.status).toBe(200);
      expect(head.headers.get("cache-control")).toBe("private, no-store");
      expect(head.headers.get("set-cookie")).toBeNull();
      expect(await counts(poll.pollId)).toEqual(before);
    },
  );

  it("GET preflight after an IP claim is 200 read-only with IP copy", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      ipChecksEnabled: true,
    });
    const post = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "POST",
        headers: voteHeaders({ "cf-connecting-ip": "198.51.100.7" }),
        body: formBody(poll.optionA),
      }),
    );
    expect((await runVoteRoute(post, poll.reference)).status).toBe(303);

    const get = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "GET",
        headers: { "cf-connecting-ip": "198.51.100.7" },
      }),
    );
    const response = await runVoteRoute(get, poll.reference);
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain("Someone on this connection already voted.");
    expect(html).not.toContain('name="option_id"');
    expect(html).not.toContain("YOUR BALLOT");
    expect(html).not.toContain("198.51.100.7");
  });

  it("HEAD preflight after an IP claim is 200 and side-effect free", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      ipChecksEnabled: true,
    });
    const post = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "POST",
        headers: voteHeaders({ "cf-connecting-ip": "198.51.100.8" }),
        body: formBody(poll.optionA),
      }),
    );
    expect((await runVoteRoute(post, poll.reference)).status).toBe(303);
    const before = await counts(poll.pollId);

    const head = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "HEAD",
        headers: { "cf-connecting-ip": "198.51.100.8" },
      }),
    );
    const response = await runVoteRoute(head, poll.reference);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await counts(poll.pollId)).toEqual(before);
  });

  it("replays a committed submission with changed or missing network identity", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      ipChecksEnabled: true,
    });
    const submissionId = crypto.randomUUID();
    const first = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "POST",
        headers: voteHeaders({ "cf-connecting-ip": "203.0.113.90" }),
        body: formBody(poll.optionA, submissionId),
      }),
    );
    expect((await runVoteRoute(first, poll.reference)).status).toBe(303);

    const replayPurposes: Array<string | null> = [];
    mockDigestSigning(async (purpose, sign) => {
      replayPurposes.push(purpose);
      return sign();
    });

    const changedIdentityReplay = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "POST",
        headers: voteHeaders({ "cf-connecting-ip": "198.51.100.200" }),
        body: formBody(poll.optionA, submissionId),
      }),
    );
    expect(
      (await runVoteRoute(changedIdentityReplay, poll.reference)).status,
    ).toBe(303);

    const missingIdentityReplay = makeContext(
      new Request(`https://polls.example.test/${poll.reference}`, {
        method: "POST",
        headers: voteHeaders(),
        body: formBody(poll.optionA, submissionId),
      }),
    );
    expect(
      (await runVoteRoute(missingIdentityReplay, poll.reference)).status,
    ).toBe(303);
    // Only the response flash is signed. Network claim and limiter work are
    // both bypassed before replay adjudication.
    expect(replayPurposes).toEqual(["session", "session"]);
    expect(await counts(poll.pollId)).toEqual({
      votes: 1,
      selections: 1,
      claims: 1,
      version: 2,
    });
  });

  it("orders Counted before closed before Session before IP on GET", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: true,
      ipChecksEnabled: true,
    });
    const voterToken = "cc".repeat(16);
    const address = "198.51.100.77";
    const posted = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          method: "POST",
          headers: voteHeaders(
            { "cf-connecting-ip": address },
            `oddspark.voter=${voterToken}`,
          ),
          body: formBody(poll.optionA),
        }),
      ),
      poll.reference,
    );
    expect(posted.status).toBe(303);
    const flashDigest = await createVoteDigest(testEnv.VOTE_DIGEST_SECRET, {
      pollId: poll.pollId,
      checkKind: "session",
      token: poll.pollId,
    });
    const flashCookie = `oddspark.vote_flash=${flashDigest}`;
    expect(await counts(poll.pollId)).toEqual({
      votes: 1,
      selections: 1,
      claims: 2,
      version: 2,
    });

    await testEnv.DB.prepare(
      "UPDATE poll SET closed_at_ms = ?2 WHERE id = ?1",
    )
      .bind(poll.pollId, Date.now() - 1)
      .run();

    const closed = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          headers: {
            "cf-connecting-ip": address,
            cookie: `oddspark.voter=${voterToken}`,
          },
        }),
      ),
      poll.reference,
    );
    const closedHtml = await closed.text();
    expect(closed.status).toBe(200);
    expect(closedHtml).toContain('data-outcome-code="poll_closed_get"');
    expect(closedHtml).not.toContain('data-outcome-code="already_voted"');
    expect(closedHtml).not.toContain('data-outcome-code="already_voted_ip"');

    const counted = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          headers: {
            "cf-connecting-ip": address,
            cookie: `oddspark.voter=${voterToken}; ${flashCookie}`,
          },
        }),
      ),
      poll.reference,
    );
    const countedHtml = await counted.text();
    expect(counted.status).toBe(200);
    expect(countedHtml).toContain('data-outcome-code="counted"');
    expect(countedHtml).not.toContain('data-outcome-code="poll_closed_get"');

    await testEnv.DB.prepare(
      "UPDATE poll SET closed_at_ms = NULL WHERE id = ?1",
    )
      .bind(poll.pollId)
      .run();

    const session = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          headers: {
            "cf-connecting-ip": address,
            cookie: `oddspark.voter=${voterToken}`,
          },
        }),
      ),
      poll.reference,
    );
    const sessionHtml = await session.text();
    expect(session.status).toBe(200);
    expect(sessionHtml).toContain('data-outcome-code="already_voted"');
    expect(sessionHtml).not.toContain('data-outcome-code="already_voted_ip"');

    const ip = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          headers: { "cf-connecting-ip": address },
        }),
      ),
      poll.reference,
    );
    const ipHtml = await ip.text();
    expect(ip.status).toBe(200);
    expect(ipHtml).toContain('data-outcome-code="already_voted_ip"');
    expect(ipHtml).not.toContain('data-outcome-code="already_voted"');
  });

  it("keeps the form open when Session digest preparation is unavailable", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: true,
      ipChecksEnabled: true,
    });
    const voterToken = "dd".repeat(16);
    const address = "198.51.100.78";
    const posted = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          method: "POST",
          headers: voteHeaders(
            { "cf-connecting-ip": address },
            `oddspark.voter=${voterToken}`,
          ),
          body: formBody(poll.optionA),
        }),
      ),
      poll.reference,
    );
    expect(posted.status).toBe(303);

    const purposes: Array<string | null> = [];
    mockDigestSigning(async (purpose, sign) => {
      purposes.push(purpose);
      if (purpose === "session") {
        throw new Error("Session digest unavailable");
      }
      return sign();
    });

    const response = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          headers: {
            "cf-connecting-ip": address,
            cookie: `oddspark.voter=${voterToken}`,
          },
        }),
      ),
      poll.reference,
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(purposes).toEqual(["session", "ip"]);
    expect(html).toContain("data-vote-form");
    expect(html).not.toContain('data-outcome-code="already_voted_ip"');
    expect(html).not.toContain("Someone on this connection already voted.");
  });

  it("does not probe IP after the Session claim lookup becomes unavailable", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: true,
      ipChecksEnabled: true,
    });
    const voterToken = "ee".repeat(16);
    const address = "198.51.100.79";
    const posted = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          method: "POST",
          headers: voteHeaders(
            { "cf-connecting-ip": address },
            `oddspark.voter=${voterToken}`,
          ),
          body: formBody(poll.optionA),
        }),
      ),
      poll.reference,
    );
    expect(posted.status).toBe(303);

    const realPrepare = testEnv.DB.prepare.bind(testEnv.DB);
    const claimLookups: unknown[] = [];
    vi.spyOn(testEnv.DB, "prepare").mockImplementation((query) => {
      const prepared = realPrepare(query);
      if (!query.includes("SELECT 1 AS found FROM voter_claim")) {
        return prepared;
      }
      const bind = prepared.bind.bind(prepared) as (
        ...values: unknown[]
      ) => D1PreparedStatement;
      return {
        bind: (...values: unknown[]) => {
          claimLookups.push(values[1]);
          const bound = bind(...values);
          if (values[1] !== "session") {
            return bound;
          }
          return {
            first: async () => {
              throw new Error("Session claim lookup unavailable");
            },
          } as unknown as D1PreparedStatement;
        },
      } as unknown as D1PreparedStatement;
    });

    const response = await runVoteRoute(
      makeContext(
        new Request(`https://polls.example.test/${poll.reference}`, {
          headers: {
            "cf-connecting-ip": address,
            cookie: `oddspark.voter=${voterToken}`,
          },
        }),
      ),
      poll.reference,
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(claimLookups).toEqual(["session"]);
    expect(html).toContain("data-vote-form");
    expect(html).not.toContain('data-outcome-code="already_voted_ip"');
    expect(html).not.toContain("Someone on this connection already voted.");
  });
});

describe("POST /:reference CAPTCHA delivery boundary", () => {
  // HTML escapes the apostrophe in didn't / it's.
  const CAPTCHA_HEADING = "The human check didn&#39;t pass.";
  const CAPTCHA_BODY = "usually just a fluke.";
  // Always-pass test site key only relaxes metadata on loopback hostnames.
  const LOOPBACK_ORIGIN = "http://127.0.0.1:8787";

  function voteHeadersLocal(
    extra: Record<string, string> = {},
    cookie = "",
  ): HeadersInit {
    return {
      "content-type": "application/x-www-form-urlencoded",
      origin: LOOPBACK_ORIGIN,
      "sec-fetch-site": "same-origin",
      ...(cookie ? { cookie } : {}),
      ...extra,
    };
  }

  function stubSiteverify(
    body: unknown,
    init: { status?: number; delayMs?: number } = {},
  ): void {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, opts) => {
      const url = String(input);
      if (!url.includes("challenges.cloudflare.com/turnstile/v0/siteverify")) {
        throw new Error(`unexpected fetch in CAPTCHA test: ${url}`);
      }
      if (init.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, init.delayMs));
      }
      // Consume body so callers cannot claim we ignored it.
      void opts?.body;
      return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    });
  }

  it("loads no Turnstile widget when CAPTCHA is off", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      captchaEnabled: false,
    });
    const response = await runVoteRoute(
      makeContext(
        new Request(`${LOOPBACK_ORIGIN}/${poll.reference}`),
      ),
      poll.reference,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).not.toContain("data-turnstile");
    expect(html).not.toContain("cf-turnstile");
  });

  it("renders the Turnstile container when CAPTCHA is on", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      captchaEnabled: true,
    });
    const response = await runVoteRoute(
      makeContext(
        new Request(`${LOOPBACK_ORIGIN}/${poll.reference}`),
      ),
      poll.reference,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("data-turnstile");
    expect(html).toContain('data-sitekey="1x00000000000000000000AA"');
    expect(html).toContain('data-action="vote"');
  });

  it("accepts a CAPTCHA-on vote when Siteverify passes", async () => {
    // Always-pass dummy success is synthetic; loopback hostname is required.
    stubSiteverify({ success: true });
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      captchaEnabled: true,
    });
    const body = formBody(poll.optionA);
    body.set("cf-turnstile-response", "valid-token");
    const response = await runVoteRoute(
      makeContext(
        new Request(`${LOOPBACK_ORIGIN}/${poll.reference}`, {
          method: "POST",
          headers: voteHeadersLocal(),
          body,
        }),
      ),
      poll.reference,
    );
    expect(response.status).toBe(303);
    expect(await counts(poll.pollId)).toMatchObject({ votes: 1 });
  });

  it("returns identical 422 captcha_failed for missing token with no mutation", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      captchaEnabled: true,
    });
    const response = await runVoteRoute(
      makeContext(
        new Request(`${LOOPBACK_ORIGIN}/${poll.reference}`, {
          method: "POST",
          headers: voteHeadersLocal(),
          body: formBody(poll.optionA),
        }),
      ),
      poll.reference,
    );
    const html = await response.text();
    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain(CAPTCHA_HEADING);
    expect(html).toContain(CAPTCHA_BODY);
    expect(html).toContain('data-outcome-code="captcha_failed"');
    expect(html).toContain(`value="${poll.optionA}"`);
    expect(html).toContain("data-turnstile");
    expect(html).not.toContain("valid-token");
    expect(html).not.toContain(String(testEnv.TURNSTILE_SECRET_KEY));
    expect(await counts(poll.pollId)).toEqual({
      votes: 0,
      selections: 0,
      claims: 0,
      version: 1,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the same safe 422 for invalid Siteverify without provider detail", async () => {
    stubSiteverify({ success: false, "error-codes": ["invalid-input-response"] });
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      captchaEnabled: true,
    });
    const body = formBody(poll.optionA);
    body.set("cf-turnstile-response", "bad-token");
    const response = await runVoteRoute(
      makeContext(
        new Request(`${LOOPBACK_ORIGIN}/${poll.reference}`, {
          method: "POST",
          headers: voteHeadersLocal(),
          body,
        }),
      ),
      poll.reference,
    );
    const html = await response.text();
    expect(response.status).toBe(422);
    expect(html).toContain(CAPTCHA_HEADING);
    expect(html).toContain(CAPTCHA_BODY);
    expect(html).not.toContain("invalid-input-response");
    expect(html).not.toContain("bad-token");
    expect(await counts(poll.pollId)).toMatchObject({ votes: 0 });
  });

  it("skips Siteverify for exact committed replay", async () => {
    stubSiteverify({ success: true });
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      captchaEnabled: true,
    });
    const submissionId = crypto.randomUUID();
    const firstBody = formBody(poll.optionA, submissionId);
    firstBody.set("cf-turnstile-response", "first-token");
    const first = await runVoteRoute(
      makeContext(
        new Request(`${LOOPBACK_ORIGIN}/${poll.reference}`, {
          method: "POST",
          headers: voteHeadersLocal(),
          body: firstBody,
        }),
      ),
      poll.reference,
    );
    expect(first.status).toBe(303);
    expect(await counts(poll.pollId)).toMatchObject({ votes: 1 });

    // Replace the Siteverify stub so a replay that incorrectly calls the
    // provider is observable without inheriting the first request's history.
    const fetchSpy = vi.fn(async () => {
      throw new Error("Siteverify must not run for committed replay");
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(
      fetchSpy as unknown as typeof fetch,
    );

    const replayBody = formBody(poll.optionA, submissionId);
    replayBody.set("cf-turnstile-response", "replay-token");
    const replay = await runVoteRoute(
      makeContext(
        new Request(`${LOOPBACK_ORIGIN}/${poll.reference}`, {
          method: "POST",
          headers: voteHeadersLocal(),
          body: replayBody,
        }),
      ),
      poll.reference,
    );
    expect(replay.status).toBe(303);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await counts(poll.pollId)).toMatchObject({ votes: 1 });
  });

  it("does not call Siteverify when CAPTCHA is off even with a forged field", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      captchaEnabled: false,
    });
    const body = formBody(poll.optionA);
    body.set("cf-turnstile-response", "forged");
    const response = await runVoteRoute(
      makeContext(
        new Request(`${LOOPBACK_ORIGIN}/${poll.reference}`, {
          method: "POST",
          headers: voteHeadersLocal(),
          body,
        }),
      ),
      poll.reference,
    );
    expect(response.status).toBe(303);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails closed for off→on race and re-renders the active widget", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      captchaEnabled: false,
    });
    await testEnv.DB.prepare(
      "UPDATE poll SET captcha_enabled = 1 WHERE id = ?1",
    )
      .bind(poll.pollId)
      .run();

    const response = await runVoteRoute(
      makeContext(
        new Request(`${LOOPBACK_ORIGIN}/${poll.reference}`, {
          method: "POST",
          headers: voteHeadersLocal(),
          body: formBody(poll.optionA),
        }),
      ),
      poll.reference,
    );
    const html = await response.text();
    expect(response.status).toBe(422);
    expect(html).toContain(CAPTCHA_HEADING);
    expect(html).toContain(CAPTCHA_BODY);
    expect(html).toContain("data-turnstile");
    expect(await counts(poll.pollId)).toMatchObject({ votes: 0 });
  });
});

describe("GET /:reference trust badge (Story 2.4)", () => {
  const BADGE_ORIGIN = "http://127.0.0.1:8787";
  const voteButtonIndex = (html: string): number =>
    html.search(/<button[^>]*>\s*VOTE\s*<\/button>/);

  it("renders the badge above the vote button on a session-only Poll", async () => {
    const poll = await seedPoll({});
    const response = await runVoteRoute(
      makeContext(new Request(`${BADGE_ORIGIN}/${poll.reference}`)),
      poll.reference,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("data-trust-badge");
    expect(html).toContain("ONE VOTE PER BROWSER");
    // Enforced-set rendering: only the active protection appears.
    expect(html).not.toContain("ONE VOTE PER NETWORK");
    expect(html).not.toContain("INVITE CODE REQUIRED");
    expect(html).not.toContain("HUMAN CHECK ON SUBMIT");
    expect(html).not.toContain("NO VPN OR DATACENTER CONNECTIONS");
    expect(html.indexOf("data-trust-badge")).toBeLessThan(
      voteButtonIndex(html),
    );
  });

  it("orders badge before challenge before button on a CAPTCHA Poll", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      captchaEnabled: true,
    });
    const response = await runVoteRoute(
      makeContext(new Request(`${BADGE_ORIGIN}/${poll.reference}`)),
      poll.reference,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("data-trust-badge");
    expect(html).toContain("HUMAN CHECK ON SUBMIT");
    expect(html).not.toContain("ONE VOTE PER BROWSER");
    // Story 2.3 AC #4 is binding: no trust line may sit between the
    // challenge and the button it protects.
    const badgeIndex = html.indexOf("data-trust-badge");
    const challengeIndex = html.indexOf("data-turnstile");
    const buttonIndex = voteButtonIndex(html);
    expect(badgeIndex).toBeGreaterThanOrEqual(0);
    expect(challengeIndex).toBeGreaterThanOrEqual(0);
    expect(buttonIndex).toBeGreaterThanOrEqual(0);
    expect(badgeIndex).toBeLessThan(challengeIndex);
    expect(challengeIndex).toBeLessThan(buttonIndex);
  });

  it("renders no badge markup at all when every Toggle is off", async () => {
    const poll = await seedPoll({
      sessionChecksEnabled: false,
      captchaEnabled: false,
    });
    const response = await runVoteRoute(
      makeContext(new Request(`${BADGE_ORIGIN}/${poll.reference}`)),
      poll.reference,
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    // Absent entirely — no empty container, no hairline (SM-C1).
    expect(html).not.toContain("data-trust-badge");
    expect(html).not.toContain("trust-badge");
    // The vote form itself is unaffected.
    expect(voteButtonIndex(html)).toBeGreaterThanOrEqual(0);
  });
});
