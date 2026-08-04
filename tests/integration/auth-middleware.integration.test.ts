import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthOptions } from "../../src/adapters/auth/index";
import { createSessionCsrfToken } from "../../src/lib/csrf";
import { onRequest } from "../../src/middleware";

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
  sessionId: string;
  userId: string;
}> {
  const auth = betterAuth({
    ...createAuthOptions(testEnv),
    emailAndPassword: { enabled: true },
  });
  const email = `${crypto.randomUUID()}@example.test`;
  const password = "integration-password-123";
  const signedUp = await auth.api.signUpEmail({
    body: {
      name: "Integration Creator",
      email,
      password,
    },
  });
  const signedIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = signedIn.headers.get("set-cookie");
  if (!cookie) throw new Error("Better Auth did not issue a session cookie");
  const session = await testEnv.DB.prepare(
    "SELECT id FROM session WHERE user_id = ? ORDER BY created_at DESC LIMIT 1",
  )
    .bind(signedUp.user.id)
    .first<{ id: string }>();
  if (!session) throw new Error("Better Auth did not persist a session");

  return {
    cookie,
    sessionId: session.id,
    userId: signedUp.user.id,
  };
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("identity delivery middleware", () => {
  it("redirects a signed-out creator request with its relative return address", async () => {
    const context = makeContext(
      new Request("https://polls.example.test/creator?draft=1"),
    );
    const response = (await onRequest(
      context,
      (() => new Response("should-not-run")) as never,
    )) as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/sign-in?return=%2Fcreator%3Fdraft%3D1",
    );
  });

  it("extracts a real Better Auth session into a provider-neutral principal", async () => {
    const { cookie, userId } = await createAuthenticatedCookie();
    const context = makeContext(
      new Request("https://polls.example.test/creator", {
        headers: { cookie },
      }),
    );
    let observedUserId: string | null = null;

    const response = (await onRequest(
      context,
      (() => {
        observedUserId = context.locals.principal?.userId ?? null;
        return new Response("creator");
      }) as never,
    )) as Response;

    expect(response.status).toBe(200);
    expect(observedUserId).toBe(userId);
    expect(context.locals.requestContext?.principal?.userId).toBe(userId);
    expect(context.locals.principal?.role).toBe("creator");
    expect(context.locals.requestContext?.csrfToken?.value).toBeTruthy();
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("oddspark.creator_session_seen=1"),
      ]),
    );
  });

  it("projects the live internal-user role independently of linked providers", async () => {
    const { cookie, userId } = await createAuthenticatedCookie();
    const now = new Date().toISOString();
    await testEnv.DB.batch([
      testEnv.DB.prepare("UPDATE user SET role = 'administrator' WHERE id = ?").bind(
        userId,
      ),
      testEnv.DB.prepare(
        `INSERT INTO account
          (id, account_id, provider_id, user_id, created_at, updated_at)
         VALUES (?, ?, 'google', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), `google-${crypto.randomUUID()}`, userId, now, now),
      testEnv.DB.prepare(
        `INSERT INTO account
          (id, account_id, provider_id, user_id, created_at, updated_at)
         VALUES (?, ?, 'github', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), `github-${crypto.randomUUID()}`, userId, now, now),
    ]);
    const context = makeContext(
      new Request("https://polls.example.test/creator", {
        headers: { cookie },
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("administrator")) as never,
    )) as Response;

    expect(response.status).toBe(200);
    expect(context.locals.principal).toMatchObject({
      userId,
      role: "administrator",
    });
  });

  it("recognizes an expired session cookie and carries expiry context", async () => {
    const { cookie } = await createAuthenticatedCookie();
    await testEnv.DB.prepare("DELETE FROM session").run();
    const context = makeContext(
      new Request("https://polls.example.test/creator/settings", {
        headers: { cookie },
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("should-not-run")) as never,
    )) as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/sign-in?return=%2Fcreator%2Fsettings&reason=expired",
    );
  });

  it("recognizes natural browser expiry from the non-sensitive session marker", async () => {
    const context = makeContext(
      new Request("https://polls.example.test/creator/settings", {
        headers: { cookie: "oddspark.creator_session_seen=1" },
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("should-not-run")) as never,
    )) as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/sign-in?return=%2Fcreator%2Fsettings&reason=expired",
    );
    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "oddspark.creator_session_seen=; Path=/; Max-Age=0",
        ),
      ]),
    );
  });

  it("ignores an empty auth cookie instead of treating it as an expired session", async () => {
    const context = makeContext(
      new Request("https://polls.example.test/creator", {
        headers: { cookie: "better-auth.session_token=" },
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("should-not-run")) as never,
    )) as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/sign-in?return=%2Fcreator",
    );
  });

  it("clears the session marker without restoring auth cookies on sign-out", async () => {
    const { cookie } = await createAuthenticatedCookie();
    const context = makeContext(
      new Request("https://polls.example.test/api/auth/sign-out", {
        method: "POST",
        headers: {
          cookie,
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
        },
      }),
    );

    const response = (await onRequest(
      context,
      (() =>
        new Response(null, {
          status: 200,
          headers: {
            "set-cookie":
              "better-auth.session_token=; Path=/; Max-Age=0; HttpOnly",
          },
        })) as never,
    )) as Response;

    expect(response.headers.getSetCookie()).toEqual(
      expect.arrayContaining([
        expect.stringContaining("better-auth.session_token=;"),
        expect.stringContaining(
          "oddspark.creator_session_seen=; Path=/; Max-Age=0",
        ),
      ]),
    );
    expect(
      response.headers
        .getSetCookie()
        .some((value) => /better-auth\.session_token=[^;]/u.test(value)),
    ).toBe(false);
  });

  it("does not treat a GET to the sign-out path as a completed sign-out", async () => {
    const { cookie } = await createAuthenticatedCookie();
    const context = makeContext(
      new Request("https://polls.example.test/api/auth/sign-out", {
        headers: { cookie },
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("not-a-sign-out")) as never,
    )) as Response;

    expect(response.status).toBe(200);
    expect(
      response.headers
        .getSetCookie()
        .some((value) =>
          /oddspark\.creator_session_seen=;\s*Path=\/;\s*Max-Age=0/u.test(
            value,
          ),
        ),
    ).toBe(false);
  });

  it("degrades to signed-out instead of 500 when the session lookup fails", async () => {
    const { cookie } = await createAuthenticatedCookie();
    // Force getSession to throw: hide the table it queries. applyD1Migrations
    // only replays unapplied migrations, so restore it explicitly — a plain
    // DROP would poison every later test in this file.
    await testEnv.DB.prepare("ALTER TABLE session RENAME TO session_hidden").run();
    try {
      const context = makeContext(
        new Request("https://polls.example.test/creator", {
          headers: { cookie },
        }),
      );

      const response = (await onRequest(
        context,
        (() => new Response("should-not-run")) as never,
      )) as Response;

      // Degraded: no principal, so the guard redirects — but without the
      // misleading "expired" reason, and no 500.
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/sign-in?return=%2Fcreator");
      expect(context.locals.requestContext?.sessionLookupFailed).toBe(true);
      expect(context.locals.requestContext?.sessionExpired).toBe(false);
      expect(context.locals.principal).toBeNull();
    } finally {
      await testEnv.DB.prepare("ALTER TABLE session_hidden RENAME TO session").run();
    }
  });

  it("does not append getSession cookies on Better Auth mount paths", async () => {
    const { cookie } = await createAuthenticatedCookie();
    // Better Auth refreshes when expiresAt - expiresIn + updateAge <= now
    // (session older than updateAge = 1 day of its 7-day life). Simulate by
    // moving expiry to 5 days out, i.e. "created 2 days ago" — getSession
    // then emits a session-refresh Set-Cookie the middleware could append.
    await testEnv.DB.prepare(
      "UPDATE session SET expires_at = ?",
    )
      .bind(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString())
      .run();
    const context = makeContext(
      new Request("https://polls.example.test/api/auth/get-session", {
        headers: { cookie },
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("auth-handler-response")) as never,
    )) as Response;

    expect(response.status).toBe(200);
    // The mount path manages its own cookies; the middleware must not append
    // any session refresh headers from its pre-handler getSession call.
    expect(
      response.headers
        .getSetCookie()
        .some((value) => /better-auth\.session_token=/u.test(value)),
    ).toBe(false);
  });

  it("still appends getSession refresh cookies on application paths", async () => {
    const { cookie } = await createAuthenticatedCookie();
    await testEnv.DB.prepare(
      "UPDATE session SET expires_at = ?",
    )
      .bind(new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString())
      .run();
    const context = makeContext(
      new Request("https://polls.example.test/creator", {
        headers: { cookie },
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("creator")) as never,
    )) as Response;

    expect(response.status).toBe(200);
    // Sanity check the fixture: the aged session really does produce a
    // refresh cookie, which application paths must keep receiving.
    expect(
      response.headers
        .getSetCookie()
        .some((value) => /better-auth\.session_token=[^;]/u.test(value)),
    ).toBe(true);
  });

  it("requires the session-bound CSRF token on authenticated creator posts", async () => {
    const { cookie } = await createAuthenticatedCookie();
    const context = makeContext(
      new Request("https://polls.example.test/creator", {
        method: "POST",
        headers: {
          cookie,
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
        },
        body: new URLSearchParams({ title: "Missing token" }),
      }),
    );
    let handlerRan = false;

    const response = (await onRequest(
      context,
      (() => {
        handlerRan = true;
        return new Response("should-not-run");
      }) as never,
    )) as Response;

    expect(response.status).toBe(403);
    expect(handlerRan).toBe(false);
  });

  it("accepts the issued token from an authenticated creator form", async () => {
    const { cookie, sessionId } = await createAuthenticatedCookie();
    const csrfToken = await createSessionCsrfToken(
      sessionId,
      testEnv.BETTER_AUTH_SECRET,
    );
    const context = makeContext(
      new Request("https://polls.example.test/creator", {
        method: "POST",
        headers: {
          cookie,
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
        },
        body: new URLSearchParams({
          title: "Protected form",
          csrf_token: csrfToken.value,
        }),
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("accepted")) as never,
    )) as Response;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("accepted");
  });

  it("accepts the issued token from the specified request header", async () => {
    const { cookie, sessionId } = await createAuthenticatedCookie();
    const csrfToken = await createSessionCsrfToken(
      sessionId,
      testEnv.BETTER_AUTH_SECRET,
    );
    const context = makeContext(
      new Request("https://polls.example.test/creator", {
        method: "POST",
        headers: {
          cookie,
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
          "x-csrf-token": csrfToken.value,
        },
        body: JSON.stringify({ title: "Protected request" }),
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("accepted")) as never,
    )) as Response;

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("accepted");
  });
});
