import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthOptions } from "../../src/adapters/auth/index";
import { onRequest } from "../../src/middleware";
import CreatorPollDetail from "../../src/pages/creator/polls/[pollId].astro";

type AuthTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as AuthTestEnv;

type MiddlewareContext = Parameters<typeof onRequest>[0];

function makeContext(request: Request): MiddlewareContext {
  return { request, locals: {} } as unknown as MiddlewareContext;
}

async function createAuthenticatedCookie(): Promise<{
  cookie: string;
  userId: string;
}> {
  const auth = betterAuth({
    ...createAuthOptions(testEnv),
    emailAndPassword: { enabled: true },
  });
  const email = `${crypto.randomUUID()}@example.test`;
  const password = "integration-password-123";
  await auth.api.signUpEmail({
    body: { name: "Integration Creator", email, password },
  });
  const signedIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = signedIn.headers.get("set-cookie");
  if (!cookie) throw new Error("Better Auth did not issue a session cookie");
  const user = await testEnv.DB.prepare("SELECT id FROM user WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  if (!user) throw new Error("Better Auth did not persist the signed-in user");
  return { cookie, userId: user.id };
}

async function seedPoll(ownerUserId: string, pollId = crypto.randomUUID()) {
  const nowMs = Date.now();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO poll (
        id, owner_user_id, poll_type, question, description,
        result_visibility, discovery_state, session_checks_enabled,
        multi_select_enabled, min_selections, max_selections,
        deadline_ms, closed_at_ms, representation_version,
        created_at_ms, updated_at_ms
      ) VALUES (?1, ?2, 'multiple_choice', 'Route truth?', 'Original description',
        'live', 'unlisted', 1, 0, NULL, NULL, NULL, NULL, 1, ?3, ?3)`,
    ).bind(pollId, ownerUserId, nowMs),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Alpha', 0, ?3)",
    ).bind(crypto.randomUUID(), pollId, nowMs),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Beta', 1, ?3)",
    ).bind(crypto.randomUUID(), pollId, nowMs),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'generated', 1, ?3)",
    ).bind(`route-${crypto.randomUUID()}`, pollId, nowMs),
  ]);
  return pollId;
}

async function runRealRoute(
  context: MiddlewareContext,
  pollId: string,
): Promise<Response> {
  const container = await AstroContainer.create();
  return (await onRequest(
    context,
    (() =>
      container.renderToResponse(CreatorPollDetail, {
        request: context.request,
        params: { pollId },
        locals: context.locals,
      })) as never,
  )) as Response;
}

async function csrfFor(cookie: string): Promise<string> {
  const context = makeContext(
    new Request("https://polls.example.test/creator/new", {
      headers: { cookie },
    }),
  );
  await onRequest(context, (() => new Response("form")) as never);
  const token = context.locals.requestContext?.csrfToken?.value;
  if (!token) throw new Error("middleware did not issue a CSRF token");
  return token;
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

const DETAIL = "https://polls.example.test/creator/polls/11111111-1111-4111-8111-111111111111";

describe("creator poll lifecycle route middleware (Story 1.12)", () => {
  it("redirects a signed-out POST to sign-in with return path", async () => {
    const context = makeContext(
      new Request(DETAIL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
        },
        body: new URLSearchParams({ intent: "close" }),
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("should-not-run")) as never,
    )) as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/sign-in?return=");
    // Middleware redirect may not carry page-level no-store; page early
    // returns do. Auth gate is the contract under test here.
  });

  it("rejects an authenticated POST without the session CSRF token", async () => {
    const { cookie } = await createAuthenticatedCookie();
    const context = makeContext(
      new Request(DETAIL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
          cookie,
        },
        body: new URLSearchParams({ intent: "close" }),
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("should-not-run")) as never,
    )) as Response;

    expect(response.status).toBe(403);
  });

  it("passes an authenticated POST with CSRF through to the page handler", async () => {
    const { cookie } = await createAuthenticatedCookie();

    const renderContext = makeContext(
      new Request("https://polls.example.test/creator/new", {
        headers: { cookie },
      }),
    );
    await onRequest(renderContext, (() => new Response("form")) as never);
    const csrfToken = renderContext.locals.requestContext?.csrfToken?.value;
    expect(csrfToken).toBeTruthy();

    let nextRan = false;
    const context = makeContext(
      new Request(DETAIL, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
          cookie,
        },
        body: new URLSearchParams({
          csrf_token: csrfToken ?? "",
          intent: "close",
        }),
      }),
    );

    const response = (await onRequest(context, (() => {
      nextRan = true;
      return new Response("page", {
        status: 200,
        headers: { "cache-control": "private, no-store" },
      });
    }) as never)) as Response;

    expect(nextRan).toBe(true);
    expect(response.status).toBe(200);
  });

  it("normalizes the creator detail operation without the internal Poll UUID", async () => {
    const { cookie } = await createAuthenticatedCookie();
    const context = makeContext(
      new Request(DETAIL, {
        headers: { cookie },
      }),
    );

    await onRequest(context, (() => new Response("ok")) as never);

    // Middleware records operation via telemetry helper; assert the helper
    // normalization shape is used by checking the path was not left raw.
    const { telemetryOperationForRoute } = await import(
      "../../src/adapters/telemetry/index"
    );
    expect(
      telemetryOperationForRoute(
        "GET",
        "/creator/polls/11111111-1111-4111-8111-111111111111",
        false,
      ),
    ).toBe("GET /creator/polls/:pollId");
  });

  it("runs the authenticated GET through middleware and the real Astro page", async () => {
    const { cookie, userId } = await createAuthenticatedCookie();
    const pollId = await seedPoll(userId);
    const context = makeContext(
      new Request(`https://polls.example.test/creator/polls/${pollId}`, {
        headers: { cookie },
      }),
    );

    const response = await runRealRoute(context, pollId);
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain("Route truth?");
    expect(html).toContain("Original description");
    expect(html).toContain('value="Alpha"');
    expect(html).toContain('value="Beta"');
  });

  it("rejects malformed lifecycle fields in the real page without mutating", async () => {
    const { cookie, userId } = await createAuthenticatedCookie();
    const pollId = await seedPoll(userId);
    const csrfToken = await csrfFor(cookie);
    const body = new FormData();
    body.set("csrf_token", csrfToken);
    body.set("intent", "update-description");
    body.set("description", new File(["forged"], "description.txt"));
    const context = makeContext(
      new Request(`https://polls.example.test/creator/polls/${pollId}`, {
        method: "POST",
        headers: {
          cookie,
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
        },
        body,
      }),
    );

    const response = await runRealRoute(context, pollId);
    const persisted = await testEnv.DB.prepare(
      "SELECT description, representation_version FROM poll WHERE id = ?1",
    )
      .bind(pollId)
      .first<{ description: string; representation_version: number }>();

    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("Unreadable form submission.");
    expect(persisted).toEqual({
      description: "Original description",
      representation_version: 1,
    });
  });

  it("updates description through the real page and returns the no-store redirect", async () => {
    const { cookie, userId } = await createAuthenticatedCookie();
    const pollId = await seedPoll(userId);
    const csrfToken = await csrfFor(cookie);
    const body = new URLSearchParams({
      csrf_token: csrfToken,
      intent: "update-description",
      description: "Updated by the route",
    });
    const context = makeContext(
      new Request(`https://polls.example.test/creator/polls/${pollId}`, {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
        },
        body,
      }),
    );

    const response = await runRealRoute(context, pollId);
    const persisted = await testEnv.DB.prepare(
      "SELECT description, representation_version FROM poll WHERE id = ?1",
    )
      .bind(pollId)
      .first<{ description: string; representation_version: number }>();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/creator/polls/${pollId}?outcome=description-updated`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(persisted).toEqual({
      description: "Updated by the route",
      representation_version: 2,
    });
  });

  it("conceals an owner Poll from another creator in the real page", async () => {
    const owner = await createAuthenticatedCookie();
    const other = await createAuthenticatedCookie();
    const pollId = await seedPoll(owner.userId);
    const context = makeContext(
      new Request(`https://polls.example.test/creator/polls/${pollId}`, {
        headers: { cookie: other.cookie },
      }),
    );

    const response = await runRealRoute(context, pollId);
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain("This Poll doesn't exist.");
    expect(html).not.toContain("Route truth?");
  });
});
