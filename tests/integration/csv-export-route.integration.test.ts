import {
  applyD1Migrations,
  type D1Migration,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthOptions } from "../../src/adapters/auth/index";
import { onRequest } from "../../src/middleware";
import {
  ALL,
  GET,
  HEAD,
} from "../../src/pages/creator/polls/[pollId]/export.csv";

type TestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;
type MiddlewareContext = Parameters<typeof onRequest>[0];

beforeEach(async () => {
  vi.restoreAllMocks();
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM vote_comment").run();
  await testEnv.DB.prepare("DELETE FROM voter_claim").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
});

async function authenticated(): Promise<{ cookie: string; userId: string }> {
  const auth = betterAuth({
    ...createAuthOptions(testEnv),
    emailAndPassword: { enabled: true },
  });
  const email = `${crypto.randomUUID()}@example.test`;
  const password = "integration-password-123";
  await auth.api.signUpEmail({
    body: { name: "CSV Route Creator", email, password },
  });
  const signedIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = signedIn.headers.get("set-cookie");
  const user = await testEnv.DB.prepare("SELECT id FROM user WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  if (!cookie || !user) throw new Error("Failed to create authenticated fixture");
  return { cookie, userId: user.id };
}

async function poll(owner: string, reference = "team-lunch"): Promise<string> {
  const pollId = crypto.randomUUID();
  const optionA = crypto.randomUUID();
  const optionB = crypto.randomUUID();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, comments_enabled, multi_select_enabled, representation_version, created_at_ms, updated_at_ms) VALUES (?1, ?2, 'multiple_choice', 'Export?', 'creator_only', 1, 1, 1, 0, 0)",
    ).bind(pollId, owner),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Alpha', 0, 0)",
    ).bind(optionA, pollId),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, '=Beta', 1, 0)",
    ).bind(optionB, pollId),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'custom', 1, 0)",
    ).bind(reference, pollId),
  ]);
  const voteId = crypto.randomUUID();
  const now = 1_800_000_000_000;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, 'route-private-submission', 'route-private-hash', ?3)",
    ).bind(voteId, pollId, now),
    testEnv.DB.prepare(
      "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
    ).bind(voteId, optionA),
    testEnv.DB.prepare(
      "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
    ).bind(voteId, optionB),
    testEnv.DB.prepare(
      "INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES (?1, ?2, '=private comment\nline', 'Name, \"quoted\"', ?3)",
    ).bind(crypto.randomUUID(), voteId, now),
  ]);
  return pollId;
}

async function requestRoute(
  handler: typeof GET,
  pollId: string,
  init: RequestInit = {},
): Promise<Response> {
  const request = new Request(
    `https://polls.example.test/creator/polls/${pollId}/export.csv`,
    init,
  );
  const context = {
    request,
    locals: {},
    params: { pollId },
  } as unknown as MiddlewareContext;
  return (await onRequest(
    context,
    (() =>
      handler(({
        request,
        locals: context.locals,
        params: { pollId },
      } as unknown) as Parameters<typeof handler>[0])) as never,
  )) as Response;
}

async function csrfFor(cookie: string): Promise<string> {
  const request = new Request("https://polls.example.test/creator", {
    headers: { cookie },
  });
  const context = {
    request,
    locals: {},
  } as unknown as MiddlewareContext;
  await onRequest(context, (() => new Response("ok")) as never);
  const token = context.locals.requestContext?.csrfToken?.value;
  if (!token) throw new Error("Middleware did not issue a CSRF token");
  return token;
}

describe("creator CSV export route", () => {
  it("delivers a direct private attachment with safe filename and no private ids", async () => {
    const owner = await authenticated();
    const pollId = await poll(owner.userId, "-team-lunch-2027-");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await requestRoute(GET, pollId, {
      headers: { cookie: owner.cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="oddspark-team-lunch-2027.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    const body = await response.text();
    expect(body).toContain('"VOTES"\r\n');
    expect(body).toContain('"\'=private comment\nline"');
    expect(body).toContain('"Name, ""quoted"""');
    expect(body).toContain('"\'=Beta","1"');
    expect(body).toContain('"VOTERS","1"');
    expect(body).not.toContain(pollId);
    expect(body).not.toContain("route-private-submission");
    expect(body).not.toContain("route-private-hash");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toEqual(
      expect.objectContaining({
        operation: "GET /creator/polls/:pollId/export.csv",
        pollId: null,
      }),
    );
  });

  it("mirrors GET headers for an explicitly bodyless HEAD", async () => {
    const owner = await authenticated();
    const pollId = await poll(owner.userId);
    const [get, head] = await Promise.all([
      requestRoute(GET, pollId, { headers: { cookie: owner.cookie } }),
      requestRoute(HEAD, pollId, {
        method: "HEAD",
        headers: { cookie: owner.cookie },
      }),
    ]);
    expect(head.status).toBe(get.status);
    for (const key of [
      "content-type",
      "content-disposition",
      "cache-control",
      "x-content-type-options",
    ]) {
      expect(head.headers.get(key)).toBe(get.headers.get(key));
    }
    expect(await head.text()).toBe("");
  });

  it("returns 405 with Allow and safe headers for an unsupported method", async () => {
    const owner = await authenticated();
    const pollId = await poll(owner.userId);
    const csrfToken = await csrfFor(owner.cookie);
    const response = await requestRoute(ALL, pollId, {
      method: "PUT",
      headers: {
        cookie: owner.cookie,
        origin: "https://polls.example.test",
        "sec-fetch-site": "same-origin",
        "x-csrf-token": csrfToken,
      },
    });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("keeps CSRF precedence ahead of unsupported-method handling", async () => {
    const owner = await authenticated();
    const pollId = await poll(owner.userId);
    const response = await requestRoute(ALL, pollId, {
      method: "PUT",
      headers: {
        cookie: owner.cookie,
        origin: "https://polls.example.test",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("allow")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("uses the creator guard for signed-out access", async () => {
    const response = await requestRoute(GET, crypto.randomUUID());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/sign-in?return=");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });

  it("conceals foreign and missing Polls with the same private 404", async () => {
    const owner = await authenticated();
    const other = await authenticated();
    const pollId = await poll(owner.userId);
    const foreign = await requestRoute(GET, pollId, {
      headers: { cookie: other.cookie },
    });
    const missing = await requestRoute(GET, crypto.randomUUID(), {
      headers: { cookie: other.cookie },
    });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await foreign.text()).toBe(await missing.text());
    expect(foreign.headers.get("cache-control")).toBe("private, no-store");
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
  });

  it("returns a safe no-partial 500 for an unsupported projection", async () => {
    const owner = await authenticated();
    const pollId = await poll(owner.userId);
    await testEnv.DB.prepare("UPDATE poll SET poll_type = 'meeting' WHERE id = ?1")
      .bind(pollId)
      .run();
    const response = await requestRoute(GET, pollId, {
      headers: { cookie: owner.cookie },
    });
    expect(response.status).toBe(500);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.text()).toBe("Export unavailable.");
  });
});
