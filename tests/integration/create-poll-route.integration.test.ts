import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { beforeEach, describe, expect, it } from "vitest";
import { createAuthOptions } from "../../src/adapters/auth/index";
import { onRequest } from "../../src/middleware";

type AuthTestEnv = Cloudflare.Env & {
  TEST_MIGRATIONS: D1Migration[];
};

const testEnv = env as AuthTestEnv;

type MiddlewareContext = Parameters<typeof onRequest>[0];

function makeContext(request: Request): MiddlewareContext {
  return { request, locals: {} } as unknown as MiddlewareContext;
}

async function createAuthenticatedCookie(): Promise<string> {
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
  return cookie;
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("POST /creator/new delivery boundary", () => {
  it("redirects an unauthenticated POST to sign-in with a return address", async () => {
    const context = makeContext(
      new Request("https://polls.example.test/creator/new", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
        },
        body: new URLSearchParams({ question: "Q" }),
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("should-not-run")) as never,
    )) as Response;

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/sign-in?return=%2Fcreator%2Fnew",
    );
  });

  it("rejects an authenticated POST without the session CSRF token", async () => {
    const cookie = await createAuthenticatedCookie();
    const context = makeContext(
      new Request("https://polls.example.test/creator/new", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
          cookie,
        },
        body: new URLSearchParams({ question: "Q" }),
      }),
    );

    const response = (await onRequest(
      context,
      (() => new Response("should-not-run")) as never,
    )) as Response;

    expect(response.status).toBe(403);
  });

  it("passes an authenticated POST carrying the session CSRF token through to the page", async () => {
    const cookie = await createAuthenticatedCookie();

    // First render of the form issues the session-bound token.
    const renderContext = makeContext(
      new Request("https://polls.example.test/creator/new", {
        headers: { cookie },
      }),
    );
    await onRequest(renderContext, (() => new Response("form")) as never);
    const csrfToken = renderContext.locals.requestContext?.csrfToken?.value;
    expect(csrfToken).toBeTruthy();

    const context = makeContext(
      new Request("https://polls.example.test/creator/new", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
          cookie,
        },
        body: new URLSearchParams({
          csrf_token: csrfToken ?? "",
          question: "Q",
        }),
      }),
    );

    let handlerRan = false;
    const response = (await onRequest(
      context,
      (() => {
        handlerRan = true;
        return new Response("page");
      }) as never,
    )) as Response;

    expect(handlerRan).toBe(true);
    expect(response.status).toBe(200);
    expect(context.locals.requestContext?.principal?.userId).toBeTruthy();
  });
});
