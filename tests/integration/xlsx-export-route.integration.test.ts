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
  XLSX_OVERSIZE_MESSAGE,
  createXlsxExportHandler,
} from "../../src/pages/creator/polls/[pollId]/export.xlsx";

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
    body: { name: "XLSX Route Creator", email, password },
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

async function seedAdditionalVotes(pollId: string, count: number): Promise<void> {
  await testEnv.DB.prepare(
    `WITH RECURSIVE indexes(value) AS (
       SELECT 1 UNION ALL SELECT value + 1 FROM indexes WHERE value < ?2
     )
     INSERT INTO vote (id, poll_id, submission_id, payload_hash, created_at_ms)
     SELECT printf('route-oversize-%04d', value), ?1,
            printf('route-oversize-submission-%04d', value),
            printf('route-oversize-private-%04d', value), 1800000000000 + value
     FROM indexes`,
  )
    .bind(pollId, count)
    .run();
}

async function requestRoute(
  handler: typeof GET,
  pollId: string,
  init: RequestInit = {},
): Promise<Response> {
  const request = new Request(
    `https://polls.example.test/creator/polls/${pollId}/export.xlsx`,
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
  const context = { request, locals: {} } as unknown as MiddlewareContext;
  await onRequest(context, (() => new Response("ok")) as never);
  const token = context.locals.requestContext?.csrfToken?.value;
  if (!token) throw new Error("Middleware did not issue a CSRF token");
  return token;
}

describe("creator XLSX export route", () => {
  it("delivers a private literal workbook with a safe filename and no private ids", async () => {
    const owner = await authenticated();
    const pollId = await poll(owner.userId, "-team-lunch-2027-");
    const response = await requestRoute(GET, pollId, {
      headers: { cookie: owner.cookie },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="oddspark-team-lunch-2027.xlsx"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-request-id")).toBeTruthy();

    const xlsx = await import("xlsx");
    const workbook = xlsx.read(await response.arrayBuffer(), {
      type: "array",
      cellFormula: true,
    });
    expect(workbook.SheetNames).toEqual(["VOTES", "TALLY", "SUMMARY"]);
    expect(
      xlsx.utils.sheet_to_json(workbook.Sheets.VOTES!, {
        header: 1,
        raw: true,
      }),
    ).toEqual([
      ["TIMESTAMP", "DISPLAY NAME", "COMMENT", "SELECTION 1", "SELECTION 2"],
      [
        "2027-01-15T08:00:00.000Z",
        "Name, \"quoted\"",
        "=private comment\nline",
        "Alpha",
        "=Beta",
      ],
    ]);
    expect(workbook.Sheets.VOTES?.C2).not.toHaveProperty("f");
    expect(JSON.stringify(workbook)).not.toContain(pollId);
    expect(JSON.stringify(workbook)).not.toContain("route-private-");
  });

  it("returns bodyless HEAD parity without invoking the workbook writer", async () => {
    const owner = await authenticated();
    const pollId = await poll(owner.userId);
    const serialize = vi.fn(async () => {
      throw new Error("HEAD must not serialize");
    });
    const head = await requestRoute(createXlsxExportHandler(serialize), pollId, {
      method: "HEAD",
      headers: { cookie: owner.cookie },
    });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(head.headers.get("content-disposition")).toContain(".xlsx");
    expect(await head.text()).toBe("");
    expect(serialize).not.toHaveBeenCalled();
    expect(HEAD).toBe(GET);
  });

  it("returns 405 with Allow and safe headers after CSRF", async () => {
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
    expect(foreign.headers.get("content-disposition")).toBeNull();
    expect(missing.headers.get("content-disposition")).toBeNull();
  });

  it("returns exact non-attachment 409 without invoking the writer", async () => {
    const owner = await authenticated();
    const pollId = await poll(owner.userId);
    await seedAdditionalVotes(pollId, 1_000);
    const serialize = vi.fn(async () => new ArrayBuffer(0));
    const response = await requestRoute(createXlsxExportHandler(serialize), pollId, {
      headers: { cookie: owner.cookie },
    });
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(XLSX_OVERSIZE_MESSAGE);
    expect(response.headers.get("content-disposition")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(serialize).not.toHaveBeenCalled();
  });

  it("returns safe no-partial 500s for projection and writer failures", async () => {
    const owner = await authenticated();
    const projectionPoll = await poll(owner.userId, "projection-failure");
    await testEnv.DB.prepare(
      "UPDATE poll SET poll_type = 'meeting' WHERE id = ?1",
    )
      .bind(projectionPoll)
      .run();
    const projection = await requestRoute(GET, projectionPoll, {
      headers: { cookie: owner.cookie },
    });
    expect(projection.status).toBe(500);
    expect(projection.headers.get("content-disposition")).toBeNull();
    expect(await projection.text()).toBe("Export unavailable.");

    const writerPoll = await poll(owner.userId, "writer-failure");
    const failing = createXlsxExportHandler(async () => {
      throw new Error("simulated worksheet invariant failure");
    });
    const writer = await requestRoute(failing, writerPoll, {
      headers: { cookie: owner.cookie },
    });
    expect(writer.status).toBe(500);
    expect(writer.headers.get("content-disposition")).toBeNull();
    expect(writer.headers.get("cache-control")).toBe("private, no-store");
    expect(await writer.text()).toBe("Export unavailable.");
  });
});
