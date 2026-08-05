import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { betterAuth } from "better-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthOptions } from "../../src/adapters/auth/index";
import { onRequest } from "../../src/middleware";
import { ALL as deleteComment } from "../../src/pages/creator/comments/delete";

type AuthTestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
type MiddlewareContext = Parameters<typeof onRequest>[0];
const testEnv = env as AuthTestEnv;
const ORIGIN = "https://polls.example.test";
const ROUTE = `${ORIGIN}/creator/comments/delete`;

function makeContext(request: Request): MiddlewareContext {
  return { request, params: {}, locals: {} } as unknown as MiddlewareContext;
}

async function dispatch(request: Request): Promise<{
  context: MiddlewareContext;
  response: Response;
}> {
  const context = makeContext(request);
  const response = (await onRequest(
    context,
    (() => deleteComment(context as never)) as never,
  )) as Response;
  return { context, response };
}

async function actor(role: "creator" | "administrator" = "creator") {
  const auth = betterAuth({
    ...createAuthOptions(testEnv),
    emailAndPassword: { enabled: true },
  });
  const email = `comment-route-${crypto.randomUUID()}@example.test`;
  const password = "integration-password-123";
  await auth.api.signUpEmail({
    body: { name: "Comment Route Actor", email, password },
  });
  const user = await testEnv.DB.prepare("SELECT id FROM user WHERE email = ?1")
    .bind(email)
    .first<{ id: string }>();
  if (!user) throw new Error("missing route actor");
  if (role === "administrator") {
    await testEnv.DB.prepare("UPDATE user SET role = 'administrator' WHERE id = ?1")
      .bind(user.id)
      .run();
  }
  const signedIn = await auth.api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookie = signedIn.headers.get("set-cookie");
  if (!cookie) throw new Error("missing route session");
  return { cookie, userId: user.id };
}

async function csrfFor(cookie: string): Promise<string> {
  const context = makeContext(new Request(`${ORIGIN}/creator`, { headers: { cookie } }));
  await onRequest(context, (() => new Response("form")) as never);
  const token = context.locals.requestContext?.csrfToken?.value;
  if (!token) throw new Error("missing route CSRF token");
  return token;
}

async function seedComment(ownerUserId: string) {
  const suffix = crypto.randomUUID();
  const pollId = `poll-${suffix}`;
  const reference = `comment-route-${suffix}`;
  const commentId = `comment-${suffix}`;
  const voteId = `vote-${suffix}`;
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO poll (id, owner_user_id, poll_type, question, result_visibility, comments_enabled, representation_version, created_at_ms, updated_at_ms) VALUES (?1, ?2, 'multiple_choice', 'Comments?', 'live', 1, 11, 0, 0)",
    ).bind(pollId, ownerUserId),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Yes', 0, 0)",
    ).bind(`option-${suffix}`, pollId),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES (?1, ?2, 'custom', 1, 0)",
    ).bind(reference, pollId),
    testEnv.DB.prepare(
      "INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms) VALUES (?1, ?2, ?3, ?4, 0)",
    ).bind(voteId, pollId, `submission-${suffix}`, `hash-${suffix}`),
    testEnv.DB.prepare(
      "INSERT INTO vote_selection (vote_id, poll_option_id) VALUES (?1, ?2)",
    ).bind(voteId, `option-${suffix}`),
    testEnv.DB.prepare(
      "INSERT INTO vote_comment (id, vote_id, body, display_name, created_at_ms) VALUES (?1, ?2, 'private-comment-sentinel', 'private-name-sentinel', 0)",
    ).bind(commentId, voteId),
  ]);
  return { commentId, pollId, reference };
}

function post(cookie: string, csrfToken: string, mode: "owner" | "administrator", commentId: string, origin = ORIGIN) {
  return new Request(ROUTE, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded",
      origin,
      "sec-fetch-site": origin === ORIGIN ? "same-origin" : "cross-site",
    },
    body: new URLSearchParams({ mode, comment_id: commentId, csrf_token: csrfToken }),
  });
}

async function persisted(pollId: string) {
  return testEnv.DB.prepare(
    "SELECT representation_version AS version, (SELECT COUNT(*) FROM vote_comment vc JOIN vote v ON v.id = vc.vote_id WHERE v.poll_id = poll.id) AS comments, (SELECT COUNT(*) FROM vote WHERE poll_id = poll.id) AS votes FROM poll WHERE id = ?1",
  ).bind(pollId).first<{ version: number; comments: number; votes: number }>();
}

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM vote_comment").run();
  await testEnv.DB.prepare("DELETE FROM vote_selection").run();
  await testEnv.DB.prepare("DELETE FROM vote").run();
  await testEnv.DB.prepare("DELETE FROM poll_option").run();
  await testEnv.DB.prepare("DELETE FROM poll_reference").run();
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("DELETE FROM account").run();
  await testEnv.DB.prepare("DELETE FROM session").run();
  await testEnv.DB.prepare("DELETE FROM verification").run();
  await testEnv.DB.prepare("DELETE FROM user").run();
  vi.restoreAllMocks();
});

describe("POST /creator/comments/delete", () => {
  it("redirects a signed-out POST to a safe GET without parsing the body", async () => {
    const sentinel = `comment-${crypto.randomUUID()}`;
    const { response } = await dispatch(
      new Request(ROUTE, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
        body: new URLSearchParams({ mode: "owner", comment_id: sentinel, csrf_token: "x" }),
      }),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/sign-in?return=%2Fcreator");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lets the owner delete only the Comment and emits identifier-free operation telemetry", async () => {
    const owner = await actor();
    const fixture = await seedComment(owner.userId);
    const csrfToken = await csrfFor(owner.cookie);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { context, response } = await dispatch(post(owner.cookie, csrfToken, "owner", fixture.commentId));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/${fixture.reference}/results`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(context.locals.requestContext?.pollId).toBe(fixture.pollId);
    expect(await persisted(fixture.pollId)).toEqual({ version: 12, comments: 0, votes: 1 });
    const raw = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(raw).toContain('"operation":"POST /creator/comments/delete"');
    expect(raw).not.toContain(fixture.commentId);
    expect(raw).not.toContain(fixture.reference);
    expect(raw).not.toContain("private-comment-sentinel");
    expect(raw).not.toContain("private-name-sentinel");
  });

  it("rejects missing, mismatched, and cross-origin CSRF before any write", async () => {
    const owner = await actor();
    const fixture = await seedComment(owner.userId);
    const csrfToken = await csrfFor(owner.cookie);
    const requests = [
      post(owner.cookie, "wrong", "owner", fixture.commentId),
      post(owner.cookie, csrfToken, "owner", fixture.commentId, "https://attacker.example"),
      new Request(ROUTE, {
        method: "POST",
        headers: { cookie: owner.cookie, "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
        body: new URLSearchParams({ mode: "owner", comment_id: fixture.commentId }),
      }),
    ];
    for (const request of requests) {
      const { context, response } = await dispatch(request);
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(context.locals.requestContext?.csrfRejected).toBe(true);
    }
    expect(await persisted(fixture.pollId)).toEqual({ version: 11, comments: 1, votes: 1 });
  });

  it("keeps wrong-owner, revoked-Administrator, stale, and malformed attempts write-free", async () => {
    const owner = await actor();
    const outsider = await actor();
    const administrator = await actor("administrator");
    const fixture = await seedComment(owner.userId);
    const outsiderCsrf = await csrfFor(outsider.cookie);
    const administratorCsrf = await csrfFor(administrator.cookie);
    await testEnv.DB.prepare("UPDATE user SET role = 'creator' WHERE id = ?1")
      .bind(administrator.userId)
      .run();
    const attempts = [
      post(outsider.cookie, outsiderCsrf, "owner", fixture.commentId),
      post(administrator.cookie, administratorCsrf, "administrator", fixture.commentId),
      post(owner.cookie, await csrfFor(owner.cookie), "owner", "missing-comment"),
    ];
    for (const request of attempts) {
      const { response } = await dispatch(request);
      expect([403, 404]).toContain(response.status);
    }
    const malformed = new URLSearchParams({ mode: "owner", comment_id: fixture.commentId, csrf_token: await csrfFor(owner.cookie), unknown: fixture.reference });
    const { response } = await dispatch(new Request(ROUTE, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/x-www-form-urlencoded", origin: ORIGIN, "sec-fetch-site": "same-origin" },
      body: malformed,
    }));
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain(fixture.reference);
    expect(await persisted(fixture.pollId)).toEqual({ version: 11, comments: 1, votes: 1 });
  });

  it("advertises only POST for unsupported methods", async () => {
    const response = await deleteComment(makeContext(new Request(ROUTE)) as never);
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
