import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthOptions } from "../../src/adapters/auth/index";
import { onRequest } from "../../src/middleware";
import ModerationPage from "../../src/pages/creator/moderation.astro";

type AuthTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

type MiddlewareContext = Parameters<typeof onRequest>[0];

const testEnv = env as AuthTestEnv;
const ORIGIN = "https://polls.example.test";
const ROUTE = `${ORIGIN}/creator/moderation`;

function makeContext(request: Request): MiddlewareContext {
  return { request, locals: {} } as unknown as MiddlewareContext;
}

async function dispatch(request: Request): Promise<{
  context: MiddlewareContext;
  response: Response;
}> {
  const context = makeContext(request);
  const container = await AstroContainer.create();
  const response = (await onRequest(
    context,
    (() =>
      container.renderToResponse(ModerationPage, {
        request: context.request,
        params: {},
        locals: context.locals,
      })) as never,
  )) as Response;
  return { context, response };
}

async function renderDirect(
  request: Request,
  userId: string,
): Promise<Response> {
  const container = await AstroContainer.create();
  return container.renderToResponse(ModerationPage, {
    request,
    params: {},
    locals: {
      principal: {
        userId,
        role: "administrator",
        session: {
          id: crypto.randomUUID(),
          userId,
          token: crypto.randomUUID(),
          expiresAt: new Date(Date.now() + 60_000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      },
      requestContext: {
        requestId: crypto.randomUUID(),
        startedAtMs: Date.now(),
        principal: null,
        csrfToken: null,
        pollId: null,
        sessionExpired: false,
        sessionLookupFailed: false,
        csrfRejected: false,
        authorizationDenied: false,
        resultsLookupFailed: false,
        demoUnavailable: false,
        voteRejection: false,
        providerOutcome: "none",
      },
    } as unknown as App.Locals,
  });
}

async function createAuthenticatedCookie(
  role: "creator" | "administrator" = "creator",
): Promise<{ cookie: string; email: string; userId: string }> {
  const auth = betterAuth({
    ...createAuthOptions(testEnv),
    emailAndPassword: { enabled: true },
  });
  const email = `moderation-route-${crypto.randomUUID()}@example.test`;
  const password = "integration-password-123";
  await auth.api.signUpEmail({
    body: { name: "Moderation Route Actor", email, password },
  });
  const user = await testEnv.DB.prepare(
    "SELECT id FROM user WHERE email = ?1",
  )
    .bind(email)
    .first<{ id: string }>();
  if (!user) throw new Error("Better Auth did not persist the route actor");
  if (role === "administrator") {
    await testEnv.DB.prepare(
      "UPDATE user SET role = 'administrator' WHERE id = ?1",
    )
      .bind(user.id)
      .run();
  }
  const signedIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = signedIn.headers.get("set-cookie");
  if (!cookie) throw new Error("Better Auth did not issue a session cookie");
  return { cookie, email, userId: user.id };
}

async function csrfFor(cookie: string): Promise<string> {
  const context = makeContext(
    new Request(ROUTE, {
      headers: { cookie },
    }),
  );
  await onRequest(context, (() => new Response("form")) as never);
  const token = context.locals.requestContext?.csrfToken?.value;
  if (!token) throw new Error("middleware did not issue a CSRF token");
  return token;
}

async function insertOwner(): Promise<{
  accountSubject: string;
  email: string;
  userId: string;
}> {
  const suffix = crypto.randomUUID();
  const userId = `moderation-owner-${suffix}`;
  const email = `owner-private-${suffix}@example.test`;
  const accountSubject = `provider-subject-private-${suffix}`;
  const now = "2026-08-04T00:00:00.000Z";
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO user
        (id, name, email, email_verified, created_at, updated_at, role)
       VALUES (?1, 'Private Poll Owner', ?2, 1, ?3, ?3, 'creator')`,
    ).bind(userId, email, now),
    testEnv.DB.prepare(
      `INSERT INTO account
        (id, account_id, provider_id, user_id, created_at, updated_at)
       VALUES (?1, ?2, 'github', ?3, ?4, ?4)`,
    ).bind(`account-${suffix}`, accountSubject, userId, now),
  ]);
  return { accountSubject, email, userId };
}

async function seedPoll(input: {
  discoveryState?: "unlisted" | "listed" | "delisted";
  ownerUserId: string;
  question?: string;
}): Promise<{
  alias: string;
  canonical: string;
  pollId: string;
  question: string;
}> {
  const suffix = crypto.randomUUID();
  const pollId = crypto.randomUUID();
  const canonical = `canonical-${suffix}`;
  const alias = `alias-${suffix}`;
  const question =
    input.question ?? "Choose <script>alert('x')</script> & enjoy?";
  const nowMs = Date.now();
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
        ?1, ?2, 'multiple_choice', ?3, 'private-description-sentinel',
        'creator_only', ?4, 1, 0, 0, 0, 0, 0, NULL, NULL,
        ?5, NULL, 7, ?6, ?6
      )`,
    ).bind(
      pollId,
      input.ownerUserId,
      question,
      input.discoveryState ?? "listed",
      nowMs + 60_000,
      nowMs,
    ),
    testEnv.DB.prepare(
      `INSERT INTO poll_reference
        (reference, poll_id, kind, is_canonical, created_at_ms)
       VALUES (?1, ?2, 'custom', 1, ?3)`,
    ).bind(canonical, pollId, nowMs),
    testEnv.DB.prepare(
      `INSERT INTO poll_reference
        (reference, poll_id, kind, is_canonical, created_at_ms)
       VALUES (?1, ?2, 'generated', 0, ?3)`,
    ).bind(alias, pollId, nowMs),
  ]);
  return { alias, canonical, pollId, question };
}

function postRequest(
  cookie: string,
  csrfToken: string,
  intent: "delist" | "clear_delisted",
  target: string,
): Request {
  return new Request(ROUTE, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: ORIGIN,
      "sec-fetch-site": "same-origin",
    },
    body: new URLSearchParams({
      csrf_token: csrfToken,
      intent,
      target,
    }),
  });
}

async function persistedModeration(pollId: string): Promise<{
  actions: Array<{
    action: string;
    next_state: string;
    prior_state: string;
  }>;
  state: string | null;
}> {
  const [poll, actions] = await Promise.all([
    testEnv.DB.prepare(
      "SELECT discovery_state FROM poll WHERE id = ?1",
    )
      .bind(pollId)
      .first<{ discovery_state: string }>(),
    testEnv.DB.prepare(
      `SELECT action, prior_state, next_state
       FROM moderation_action WHERE poll_id = ?1 ORDER BY sequence`,
    )
      .bind(pollId)
      .all<{
        action: string;
        next_state: string;
        prior_state: string;
      }>(),
  ]);
  return {
    state: poll?.discovery_state ?? null,
    actions: actions.results,
  };
}

function telemetryRecords(
  spy: { mock: { calls: unknown[][] } },
): Array<Record<string, unknown>> {
  return spy.mock.calls.flatMap((call) => {
    if (typeof call[0] !== "string") return [];
    try {
      const parsed: unknown = JSON.parse(call[0]);
      return typeof parsed === "object" && parsed !== null
        ? [parsed as Record<string, unknown>]
        : [];
    } catch {
      return [];
    }
  });
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DROP TRIGGER IF EXISTS fail_moderation_route").run();
  await testEnv.DB.prepare("DELETE FROM moderation_action").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("DELETE FROM account").run();
  await testEnv.DB.prepare("DELETE FROM session").run();
  await testEnv.DB.prepare("DELETE FROM verification").run();
  await testEnv.DB.prepare("DELETE FROM user").run();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/creator/moderation delivery and capability boundary", () => {
  it("redirects signed-out and expired requests without carrying target data", async () => {
    const sentinel = `private-target-${crypto.randomUUID()}`;
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const requests = [
      new Request(ROUTE),
      new Request(`${ROUTE}?target=${sentinel}&outcome=delisted`),
      new Request(`${ROUTE}?target=${sentinel}`, {
        headers: { cookie: "oddspark.creator_session_seen=1" },
      }),
    ];

    for (const [index, request] of requests.entries()) {
      const { response } = await dispatch(request);
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        index === 2
          ? "/sign-in?return=%2Fcreator%2Fmoderation&reason=expired"
          : "/sign-in?return=%2Fcreator%2Fmoderation",
      );
      expect(response.headers.get("location")).not.toContain(sentinel);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store",
      );
    }
    expect(JSON.stringify(telemetryRecords(log))).not.toContain(sentinel);
    expect(telemetryRecords(log)).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({
          operation: "GET /creator/moderation",
          pollId: null,
        }),
      ),
    );
  });

  it("serves the initial Administrator GET and HEAD with private no-store parity", async () => {
    const { cookie } = await createAuthenticatedCookie("administrator");
    const get = await dispatch(
      new Request(ROUTE, { headers: { cookie } }),
    );
    const getHtml = await get.response.text();
    const head = await dispatch(
      new Request(ROUTE, { method: "HEAD", headers: { cookie } }),
    );

    expect(get.response.status).toBe(200);
    expect(get.response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(getHtml).toContain('name="target"');
    expect(head.response.status).toBe(200);
    expect(head.response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(await head.response.text()).toBe("");
  });

  it("rejects unsupported direct page methods before reading D1", async () => {
    const { userId } = await createAuthenticatedCookie("administrator");
    const prepare = vi.spyOn(testEnv.DB, "prepare");

    const response = await renderDirect(
      new Request(ROUTE, { method: "PUT" }),
      userId,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, POST");
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(prepare).not.toHaveBeenCalled();
  });

  it("denies every non-Administrator GET before lookup or target disclosure", async () => {
    const actor = await createAuthenticatedCookie();
    const poll = await seedPoll({ ownerUserId: actor.userId });
    const prepare = vi.spyOn(testEnv.DB, "prepare");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const requests = [
      `${ROUTE}?target=${encodeURIComponent(poll.alias)}`,
      `${ROUTE}?target=missing-reference`,
      `${ROUTE}?target=${encodeURIComponent("https://attacker.example/private")}`,
    ];

    for (const url of requests) {
      const { context, response } = await dispatch(
        new Request(url, { headers: { cookie: actor.cookie } }),
      );
      const html = await response.text();
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      expect(context.locals.requestContext?.authorizationDenied).toBe(true);
      expect(context.locals.requestContext?.csrfRejected).toBe(false);
      expect(html).toContain("Administrator access required.");
      expect(html).not.toContain(poll.question);
      expect(html).not.toContain(poll.alias);
    }

    const preparedSql = prepare.mock.calls.map((call) => String(call[0]));
    expect(preparedSql.some((sql) => sql.includes("poll_reference"))).toBe(
      false,
    );
    expect(telemetryRecords(log)).toHaveLength(3);
    expect(telemetryRecords(log)).toEqual(
      Array.from({ length: 3 }, () =>
        expect.objectContaining({
          operation: "GET /creator/moderation",
          result: "authorization_denied",
          pollId: null,
        }),
      ),
    );
  });

  it("keeps central CSRF rejection ahead of Administrator capability code", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const owner = await insertOwner();
    const poll = await seedPoll({ ownerUserId: owner.userId });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = makeContext(
      new Request(ROUTE, {
        method: "POST",
        headers: {
          cookie: actor.cookie,
          "content-type": "application/x-www-form-urlencoded",
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
        },
        body: new URLSearchParams({ intent: "delist", target: poll.alias }),
      }),
    );
    const container = await AstroContainer.create();
    const response = (await onRequest(
      context,
      (() =>
        container.renderToResponse(ModerationPage, {
          request: context.request,
          params: {},
          locals: context.locals,
        })) as never,
    )) as Response;

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(await response.text()).toBe("Forbidden");
    expect(context.locals.requestContext?.csrfRejected).toBe(true);
    expect(context.locals.requestContext?.authorizationDenied).toBe(false);
    expect(await persistedModeration(poll.pollId)).toEqual({
      state: "listed",
      actions: [],
    });
    expect(telemetryRecords(log)).toEqual([
      expect.objectContaining({
        operation: "POST /creator/moderation",
        result: "csrf_rejected",
        pollId: null,
      }),
    ]);
  });

  it("denies valid-CSRF non-Administrator commands for both intents without writes", async () => {
    const actor = await createAuthenticatedCookie();
    const poll = await seedPoll({ ownerUserId: actor.userId });
    const csrfToken = await csrfFor(actor.cookie);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    for (const intent of ["delist", "clear_delisted"] as const) {
      const { context, response } = await dispatch(
        postRequest(actor.cookie, csrfToken, intent, poll.alias),
      );
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      expect(context.locals.requestContext?.authorizationDenied).toBe(true);
      expect(context.locals.requestContext?.csrfRejected).toBe(false);
    }

    expect(await persistedModeration(poll.pollId)).toEqual({
      state: "listed",
      actions: [],
    });
    expect(telemetryRecords(log)).toEqual([
      expect.objectContaining({
        operation: "POST /creator/moderation",
        result: "authorization_denied",
        pollId: null,
      }),
      expect.objectContaining({
        operation: "POST /creator/moderation",
        result: "authorization_denied",
        pollId: null,
      }),
    ]);
  });
});

describe("/creator/moderation strict lookup and command contract", () => {
  it("resolves an alias to escaped, canonical, minimum moderation context", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const owner = await insertOwner();
    const poll = await seedPoll({ ownerUserId: owner.userId });

    const { context, response } = await dispatch(
      new Request(`${ROUTE}?target=${encodeURIComponent(poll.alias)}`, {
        headers: { cookie: actor.cookie },
      }),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(html).toContain(
      "Choose &lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; enjoy?",
    );
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).not.toContain("&amp;lt;script");
    expect(html).toContain(`href="/${poll.canonical}"`);
    expect(html).toContain(`value="${poll.canonical}"`);
    expect(html).toContain("OPEN");
    expect(html).toContain("LISTED");
    expect(html).toContain("DELIST");
    expect(html).not.toContain(poll.alias);
    expect(html).not.toContain(poll.pollId);
    expect(html).not.toContain(owner.userId);
    expect(html).not.toContain(owner.email);
    expect(html).not.toContain(owner.accountSubject);
    expect(html).not.toContain("private-description-sentinel");
    expect(html).not.toContain("creator_only");
    expect(context.locals.requestContext?.pollId).toBe(poll.pollId);
  });

  it("keeps Discovery moderation usable when Comment projection fails", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const owner = await insertOwner();
    const poll = await seedPoll({ ownerUserId: owner.userId });
    const csrfToken = await csrfFor(actor.cookie);
    const voteId = crypto.randomUUID();
    const nowMs = Date.now();
    await testEnv.DB.batch([
      testEnv.DB.prepare(
        "UPDATE poll SET comments_enabled = 1 WHERE id = ?1",
      ).bind(poll.pollId),
      testEnv.DB.prepare(
        "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
      ).bind(voteId, poll.pollId, crypto.randomUUID(), "malformed-comment-hash", nowMs),
      testEnv.DB.prepare(
        "INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES (?1, ?2, ' malformed ', NULL, ?3)",
      ).bind(crypto.randomUUID(), voteId, nowMs),
    ]);

    const { response } = await dispatch(
      postRequest(actor.cookie, csrfToken, "delist", poll.alias),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      `target=${encodeURIComponent(poll.canonical)}`,
    );
    expect(await persistedModeration(poll.pollId)).toEqual({
      state: "delisted",
      actions: [{
        action: "delist",
        next_state: "delisted",
        prior_state: "listed",
      }],
    });
  });

  it("rejects duplicate, missing, unknown, and oversized query values safely", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const secret = `query-private-${crypto.randomUUID()}`;
    const urls = [
      `${ROUTE}?target=${secret}&target=${secret}`,
      `${ROUTE}?outcome=delisted`,
      `${ROUTE}?target=${secret}&unknown=${secret}`,
      `${ROUTE}?target=${"x".repeat(513)}`,
    ];

    for (const url of urls) {
      const { context, response } = await dispatch(
        new Request(url, { headers: { cookie: actor.cookie } }),
      );
      const html = await response.text();
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      expect(html).not.toContain(secret);
      expect(context.locals.requestContext?.pollId).toBeNull();
    }
  });

  it("renders safe GET and POST not-found states without reflecting the submitted reference", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const missing = `missing-${crypto.randomUUID()}`;
    const csrfToken = await csrfFor(actor.cookie);
    const responses = [
      await dispatch(
        new Request(`${ROUTE}?target=${missing}`, {
          headers: { cookie: actor.cookie },
        }),
      ),
      await dispatch(
        postRequest(actor.cookie, csrfToken, "delist", missing),
      ),
    ];

    for (const { context, response } of responses) {
      const html = await response.text();
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      expect(html).toContain("This Poll doesn&#39;t exist.");
      expect(html).not.toContain(missing);
      expect(context.locals.requestContext?.pollId).toBeNull();
    }
  });

  it("rejects strict malformed forms without changing persisted truth", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const owner = await insertOwner();
    const poll = await seedPoll({ ownerUserId: owner.userId });
    const csrfToken = await csrfFor(actor.cookie);
    const duplicate = new URLSearchParams({
      csrf_token: csrfToken,
      intent: "delist",
      target: poll.alias,
    });
    duplicate.append("target", poll.canonical);
    const unknown = new URLSearchParams({
      csrf_token: csrfToken,
      intent: "delist",
      target: poll.alias,
      owner: owner.userId,
    });
    const hostileTarget = new URLSearchParams({
      csrf_token: csrfToken,
      intent: "delist",
      target: "https://attacker.example/private-reference",
    });

    for (const body of [duplicate, unknown, hostileTarget]) {
      const { response } = await dispatch(
        new Request(ROUTE, {
          method: "POST",
          headers: {
            cookie: actor.cookie,
            "content-type": "application/x-www-form-urlencoded",
            origin: ORIGIN,
            "sec-fetch-site": "same-origin",
          },
          body,
        }),
      );
      const html = await response.text();
      expect(response.status).toBe(422);
      expect(response.headers.get("cache-control")).toBe(
        "private, no-store",
      );
      expect(html).not.toContain(owner.userId);
      expect(html).not.toContain("private-reference");
    }

    expect(await persistedModeration(poll.pollId)).toEqual({
      state: "listed",
      actions: [],
    });
  });

  it("canonicalizes successful delist and clear POSTs through 303 and fresh GET", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const owner = await insertOwner();
    const poll = await seedPoll({ ownerUserId: owner.userId });
    const csrfToken = await csrfFor(actor.cookie);

    const delist = await dispatch(
      postRequest(actor.cookie, csrfToken, "delist", poll.alias),
    );
    expect(delist.response.status).toBe(303);
    expect(delist.response.headers.get("location")).toBe(
      `/creator/moderation?target=${poll.canonical}&outcome=delisted`,
    );
    expect(delist.response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(await persistedModeration(poll.pollId)).toEqual({
      state: "delisted",
      actions: [
        {
          action: "delist",
          prior_state: "listed",
          next_state: "delisted",
        },
      ],
    });

    const afterDelist = await dispatch(
      new Request(`${ORIGIN}${delist.response.headers.get("location")}`, {
        headers: { cookie: actor.cookie },
      }),
    );
    const delistedHtml = await afterDelist.response.text();
    expect(afterDelist.response.status).toBe(200);
    expect(delistedHtml).toContain("Poll delisted.");
    expect(delistedHtml).toContain("DELISTED");
    expect(delistedHtml).toContain("CLEAR DELISTED");

    const clear = await dispatch(
      postRequest(
        actor.cookie,
        csrfToken,
        "clear_delisted",
        poll.canonical,
      ),
    );
    expect(clear.response.status).toBe(303);
    expect(clear.response.headers.get("location")).toBe(
      `/creator/moderation?target=${poll.canonical}&outcome=cleared`,
    );
    expect(clear.response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(await persistedModeration(poll.pollId)).toEqual({
      state: "listed",
      actions: [
        {
          action: "delist",
          prior_state: "listed",
          next_state: "delisted",
        },
        {
          action: "clear_delisted",
          prior_state: "delisted",
          next_state: "listed",
        },
      ],
    });

    const afterClear = await dispatch(
      new Request(`${ORIGIN}${clear.response.headers.get("location")}`, {
        headers: { cookie: actor.cookie },
      }),
    );
    const clearedHtml = await afterClear.response.text();
    expect(afterClear.response.status).toBe(200);
    expect(clearedHtml).toContain("Delisting cleared.");
    expect(clearedHtml).toContain("LISTED");
    expect(clearedHtml).toContain("DELIST");
  });

  it("hides forged or state-mismatched display-only outcomes", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const owner = await insertOwner();
    const poll = await seedPoll({ ownerUserId: owner.userId });

    const forged = await dispatch(
      new Request(
        `${ROUTE}?target=${poll.canonical}&outcome=owner-private-result`,
        { headers: { cookie: actor.cookie } },
      ),
    );
    const forgedHtml = await forged.response.text();
    expect(forged.response.status).toBe(400);
    expect(forgedHtml).not.toContain("owner-private-result");
    expect(forgedHtml).not.toContain("Poll delisted.");
    expect(forgedHtml).not.toContain("Delisting cleared.");

    const mismatchedDelist = await dispatch(
      new Request(
        `${ROUTE}?target=${poll.canonical}&outcome=delisted`,
        { headers: { cookie: actor.cookie } },
      ),
    );
    expect(await mismatchedDelist.response.text()).not.toContain(
      "Poll delisted.",
    );

    await testEnv.DB.prepare(
      "UPDATE poll SET discovery_state = 'delisted' WHERE id = ?1",
    )
      .bind(poll.pollId)
      .run();
    const mismatchedClear = await dispatch(
      new Request(
        `${ROUTE}?target=${poll.canonical}&outcome=cleared`,
        { headers: { cookie: actor.cookie } },
      ),
    );
    expect(await mismatchedClear.response.text()).not.toContain(
      "Delisting cleared.",
    );
  });

  it("maps lookup failure to one outer safe telemetry record without cause leakage", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const owner = await insertOwner();
    const poll = await seedPoll({ ownerUserId: owner.userId });
    const privateDetail = `private lookup failure ${crypto.randomUUID()}`;
    const realPrepare = testEnv.DB.prepare.bind(testEnv.DB);
    vi.spyOn(testEnv.DB, "prepare").mockImplementation((query) => {
      if (query.includes("FROM poll_reference AS requested")) {
        throw new Error(privateDetail);
      }
      return realPrepare(query);
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { context, response } = await dispatch(
      new Request(`${ROUTE}?target=${poll.alias}`, {
        headers: { cookie: actor.cookie },
      }),
    );
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(html).toContain("The Poll couldn&#39;t be loaded. Try again.");
    expect(html).not.toContain(privateDetail);
    expect(html).not.toContain(poll.alias);
    expect(context.locals.requestContext?.pollId).toBeNull();
    expect(telemetryRecords(log)).toEqual([
      expect.objectContaining({
        operation: "GET /creator/moderation",
        result: "error",
        pollId: null,
      }),
    ]);
    expect(error).not.toHaveBeenCalled();
    expect(
      JSON.stringify([...log.mock.calls, ...error.mock.calls]),
    ).not.toContain(privateDetail);
  });

  it("rolls a persistence failure back with one outer safe telemetry record", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const owner = await insertOwner();
    const poll = await seedPoll({ ownerUserId: owner.userId });
    const csrfToken = await csrfFor(actor.cookie);
    const privateDetail = `private persistence failure ${crypto.randomUUID()}`;
    await testEnv.DB.prepare(
      `CREATE TRIGGER fail_moderation_route
       BEFORE UPDATE OF discovery_state ON poll
       WHEN NEW.discovery_state = 'delisted'
       BEGIN
         SELECT RAISE(ABORT, '${privateDetail}');
       END`,
    ).run();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { context, response } = await dispatch(
      postRequest(actor.cookie, csrfToken, "delist", poll.alias),
    );
    const html = await response.text();

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store",
    );
    expect(html).toContain(
      "The moderation change couldn&#39;t be confirmed. Reload before trying again.",
    );
    expect(html).not.toContain(privateDetail);
    expect(await persistedModeration(poll.pollId)).toEqual({
      state: "listed",
      actions: [],
    });
    expect(context.locals.requestContext?.pollId).toBe(poll.pollId);
    expect(telemetryRecords(log)).toEqual([
      expect.objectContaining({
        operation: "POST /creator/moderation",
        result: "error",
        pollId: poll.pollId,
      }),
    ]);
    expect(error).not.toHaveBeenCalled();
    expect(
      JSON.stringify([...log.mock.calls, ...error.mock.calls]),
    ).not.toContain(privateDetail);
  });

  it("emits one fixed method-qualified, privacy-safe record with only internal Poll correlation", async () => {
    const actor = await createAuthenticatedCookie("administrator");
    const owner = await insertOwner();
    const poll = await seedPoll({ ownerUserId: owner.userId });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const { response } = await dispatch(
      new Request(`${ROUTE}?target=${encodeURIComponent(poll.alias)}`, {
        headers: { cookie: actor.cookie },
      }),
    );
    await response.text();

    const records = telemetryRecords(log);
    expect(records).toEqual([
      {
        requestId: expect.any(String),
        operation: "GET /creator/moderation",
        result: "ok",
        durationMs: expect.any(Number),
        providerOutcome: "none",
        pollId: poll.pollId,
      },
    ]);
    const serialized = JSON.stringify(records);
    for (const forbidden of [
      poll.alias,
      poll.canonical,
      poll.question,
      owner.userId,
      owner.email,
      owner.accountSubject,
      actor.userId,
      actor.email,
      "github",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
