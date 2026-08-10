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
import CreatorNew from "../../src/pages/creator/new.astro";

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

async function runRealRoute(context: MiddlewareContext): Promise<Response> {
  const container = await AstroContainer.create();
  return (await onRequest(
    context,
    (() =>
      container.renderToResponse(CreatorNew, {
        request: context.request,
        locals: context.locals,
      })) as never,
  )) as Response;
}

async function postCreate(
  cookie: string,
  csrfToken: string,
  pollId: string,
  listing: string,
): Promise<Response> {
  const body = new URLSearchParams({
    csrf_token: csrfToken,
    intent: "publish",
    poll_id: pollId,
    question: "Where should we go?",
    visibility: "live",
    listing,
    multiSelect: "false",
    sessionChecks: "true",
  });
  body.append("option", "Alpha");
  body.append("option", "Beta");
  return runRealRoute(
    makeContext(
      new Request("https://polls.example.test/creator/new", {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
        },
        body,
      }),
    ),
  );
}

async function postMeeting(
  cookie: string,
  csrfToken: string,
  pollId: string,
  intent: "publish" | "add-slot",
  slots: { date: string; start: string; end: string }[],
): Promise<Response> {
  const body = new URLSearchParams({
    csrf_token: csrfToken,
    intent,
    poll_id: pollId,
    pollType: "meeting",
    question: "When should we meet?",
    visibility: "live",
    listing: "unlisted",
    timezone: "America/Detroit",
    multiSelect: "false",
    sessionChecks: "true",
  });
  slots.forEach((slot, index) => {
    body.set(`slot_date_${index}`, slot.date);
    body.set(`slot_start_${index}`, slot.start);
    body.set(`slot_end_${index}`, slot.end);
  });
  return runRealRoute(
    makeContext(
      new Request("https://polls.example.test/creator/new", {
        method: "POST",
        headers: {
          cookie,
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://polls.example.test",
          "sec-fetch-site": "same-origin",
        },
        body,
      }),
    ),
  );
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});

describe("POST /creator/new delivery boundary", () => {
  it("adds exactly one blank Meeting slot on a server round-trip", async () => {
    const cookie = await createAuthenticatedCookie();
    const response = await postMeeting(
      cookie,
      await csrfFor(cookie),
      crypto.randomUUID(),
      "add-slot",
      [
        { date: "2027-01-15", start: "09:00", end: "09:30" },
        { date: "2027-01-16", start: "14:00", end: "15:30" },
      ],
    );
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain("One blank slot added");
    expect(html.match(/data-slot-row/g)).toHaveLength(3);
    expect(html).toContain('value="2027-01-15"');
    expect(html).toContain("TIMES IN America/Detroit");
  });

  it("re-renders an end-before-start Meeting slot inline with all values", async () => {
    const cookie = await createAuthenticatedCookie();
    const response = await postMeeting(
      cookie,
      await csrfFor(cookie),
      crypto.randomUUID(),
      "publish",
      [
        { date: "2027-01-15", start: "10:00", end: "09:00" },
        { date: "2027-01-16", start: "14:00", end: "15:30" },
      ],
    );
    const html = await response.text();
    expect(response.status).toBe(422);
    expect(html).toContain("This slot ends before it starts. Check the times.");
    expect(html).toContain('value="10:00"');
    expect(html).toContain('value="09:00"');
    expect(html).toContain('value="2027-01-16"');
  });

  it("publishes heterogeneous Meeting slots as absolute instants", async () => {
    const cookie = await createAuthenticatedCookie();
    const pollId = crypto.randomUUID();
    const response = await postMeeting(
      cookie,
      await csrfFor(cookie),
      pollId,
      "publish",
      [
        { date: "2027-01-15", start: "09:00", end: "09:30" },
        { date: "2027-01-16", start: "14:00", end: "15:30" },
      ],
    );
    const rows = await testEnv.DB.prepare(
      "SELECT position, starts_at_ms, ends_at_ms, time_zone FROM meeting_slot WHERE poll_id = ?1 ORDER BY position",
    )
      .bind(pollId)
      .all();
    expect(response.status).toBe(303);
    expect(rows.results).toEqual([
      {
        position: 0,
        starts_at_ms: Date.parse("2027-01-15T14:00:00.000Z"),
        ends_at_ms: Date.parse("2027-01-15T14:30:00.000Z"),
        time_zone: "America/Detroit",
      },
      {
        position: 1,
        starts_at_ms: Date.parse("2027-01-16T19:00:00.000Z"),
        ends_at_ms: Date.parse("2027-01-16T20:30:00.000Z"),
        time_zone: "America/Detroit",
      },
    ]);
  });

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

  it("persists form-driven Security Toggles through the real create page", async () => {
    const cookie = await createAuthenticatedCookie();
    const csrfToken = await csrfFor(cookie);
    const pollId = crypto.randomUUID();
    const body = new URLSearchParams({
      csrf_token: csrfToken,
      intent: "publish",
      poll_id: pollId,
      question: "Which protections?",
      visibility: "live",
      listing: "unlisted",
      multiSelect: "false",
      sessionChecks: "true",
      ipChecks: "true",
      captcha: "true",
    });
    body.append("option", "Alpha");
    body.append("option", "Beta");
    const context = makeContext(
      new Request("https://polls.example.test/creator/new", {
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

    const response = await runRealRoute(context);
    const persisted = await testEnv.DB.prepare(
      `SELECT session_checks_enabled, ip_checks_enabled,
              voter_codes_enabled, captcha_enabled, vpn_blocking_enabled
         FROM poll WHERE id = ?1`,
    )
      .bind(pollId)
      .first<{
        session_checks_enabled: number;
        ip_checks_enabled: number;
        voter_codes_enabled: number;
        captcha_enabled: number;
        vpn_blocking_enabled: number;
      }>();

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      `/creator/polls/${pollId}?created`,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(persisted).toEqual({
      session_checks_enabled: 1,
      ip_checks_enabled: 1,
      voter_codes_enabled: 0,
      captcha_enabled: 1,
      vpn_blocking_enabled: 0,
    });
  });

  it("persists the fresh-form Unlisted choice", async () => {
    const cookie = await createAuthenticatedCookie();
    const csrfToken = await csrfFor(cookie);
    const pollId = crypto.randomUUID();

    const response = await postCreate(
      cookie,
      csrfToken,
      pollId,
      "unlisted",
    );
    const row = await testEnv.DB.prepare(
      "SELECT discovery_state AS state FROM poll WHERE id = ?1",
    )
      .bind(pollId)
      .first<{ state: string }>();

    expect(response.status).toBe(303);
    expect(row?.state).toBe("unlisted");
  });

  it("persists an explicit Listed creation choice", async () => {
    const cookie = await createAuthenticatedCookie();
    const csrfToken = await csrfFor(cookie);
    const pollId = crypto.randomUUID();

    const response = await postCreate(cookie, csrfToken, pollId, "listed");
    const row = await testEnv.DB.prepare(
      "SELECT discovery_state AS state FROM poll WHERE id = ?1",
    )
      .bind(pollId)
      .first<{ state: string }>();

    expect(response.status).toBe(303);
    expect(row?.state).toBe("listed");
  });

  it("rejects a tampered listing and re-renders the chooser", async () => {
    const cookie = await createAuthenticatedCookie();
    const csrfToken = await csrfFor(cookie);
    const pollId = crypto.randomUUID();

    const response = await postCreate(cookie, csrfToken, pollId, "delisted");
    const html = await response.text();
    const row = await testEnv.DB.prepare(
      "SELECT discovery_state AS state FROM poll WHERE id = ?1",
    )
      .bind(pollId)
      .first<{ state: string }>();

    expect(response.status).toBe(422);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain("Pick a Discovery Setting.");
    expect(html).toContain('id="listing-unlisted"');
    expect(html).toContain('id="listing-listed"');
    expect(row).toBeNull();
  });
});
