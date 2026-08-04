import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Landing from "../../src/pages/index.astro";
import tokensCss from "../../src/styles/tokens.css?raw";
import { onRequest } from "../../src/middleware";
import { VOTER_COOKIE_NAME } from "../../src/adapters/digest/index";

const ORIGIN = "https://polls.example.test";
const VOTE_ORIGIN = "http://127.0.0.1";
const solarHex = tokensCss.match(
  /--color-solar-dark:\s*(#[0-9a-fA-F]{3,8})\s*;/,
)?.[1];

type TestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;
type MiddlewareContext = Parameters<typeof onRequest>[0];
const OWNER = "landing-demo-owner";
const mutableEnv = testEnv as unknown as Record<string, unknown>;
const originalDemoReference = testEnv.DEMO_POLL_REFERENCE;
let currentDemo: { optionId: string; pollId: string };

function contextFor(request: Request): MiddlewareContext {
  return { request, locals: {} } as unknown as MiddlewareContext;
}

async function render(request: Request): Promise<Response> {
  const container = await AstroContainer.create();
  const context = contextFor(request);
  return (await onRequest(
    context,
    (() => container.renderToResponse(Landing, {
      request,
      locals: context.locals,
    })) as never,
  )) as Response;
}

async function seedDemo(): Promise<{ optionId: string; pollId: string }> {
  const pollId = crypto.randomUUID();
  const optionIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const now = Date.now();
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?1, 'Landing Demo', 'landing-demo@example.test', 1,
         '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')`,
    ).bind(OWNER),
    testEnv.DB.prepare(
      `INSERT INTO poll (
        id, owner_user_id, poll_type, question, result_visibility,
        discovery_state, session_checks_enabled, ip_checks_enabled,
        voter_codes_enabled, captcha_enabled, vpn_blocking_enabled,
        multi_select_enabled, min_selections, max_selections,
        deadline_ms, closed_at_ms, representation_version,
        created_at_ms, updated_at_ms
      ) VALUES (?1, ?2, 'multiple_choice', 'Best day for a long weekend?',
        'live', 'unlisted', 1, 0, 0, 1, 0, 0, NULL, NULL,
        NULL, NULL, 1, ?3, ?3)`,
    ).bind(pollId, OWNER, now),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Friday', 0, ?3)",
    ).bind(optionIds[0], pollId, now),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Monday', 1, ?3)",
    ).bind(optionIds[1], pollId, now),
    testEnv.DB.prepare(
      "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, 'Either works', 2, ?3)",
    ).bind(optionIds[2], pollId, now),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('demo', ?1, 'custom', 1, ?2)",
    ).bind(pollId, now),
  ]);
  return { optionId: optionIds[0], pollId };
}

function cookieValue(response: Response, name: string): string {
  const pair = response.headers.getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(";")[0];
  if (!pair) throw new Error(`Missing cookie ${name}`);
  return pair;
}

async function freshBallot(): Promise<{
  cookie: string;
  optionId: string;
  submissionId: string;
}> {
  const response = await render(new Request(`${VOTE_ORIGIN}/`));
  const html = await response.text();
  const submissionId = /name="submission_id" value="([^"]+)"/u.exec(html)?.[1];
  const optionId = /name="option_id" value="([^"]+)"/u.exec(html)?.[1];
  if (!submissionId || !optionId) throw new Error("Fresh Demo ballot is incomplete");
  return {
    cookie: cookieValue(response, VOTER_COOKIE_NAME),
    optionId,
    submissionId,
  };
}

function submitBallot(
  ballot: Awaited<ReturnType<typeof freshBallot>>,
  token: string,
  ip = "203.0.113.44",
): Promise<Response> {
  return render(new Request(`${VOTE_ORIGIN}/`, {
    method: "POST",
    headers: {
      cookie: ballot.cookie,
      "content-type": "application/x-www-form-urlencoded",
      origin: VOTE_ORIGIN,
      "sec-fetch-site": "same-origin",
      "cf-connecting-ip": ip,
    },
    body: new URLSearchParams({
      submission_id: ballot.submissionId,
      option_id: ballot.optionId,
      "cf-turnstile-response": token,
    }),
  }));
}

beforeEach(async () => {
  mutableEnv.DEMO_POLL_REFERENCE = originalDemoReference;
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("DELETE FROM user").run();
  currentDemo = await seedDemo();
});

afterEach(() => {
  mutableEnv.DEMO_POLL_REFERENCE = originalDemoReference;
  vi.restoreAllMocks();
});

describe("SSR / landing route", () => {
  it("renders indexable canonical HTML with the current solar smoke marker", async () => {
    expect(tokensCss).toContain("--color-solar-dark");
    expect(solarHex).toBeTruthy();
    const response = await render(new Request(`${ORIGIN}/`));
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(
      "Oddspark Polls is where a casual question gets an honest answer",
    );
    expect(html).toContain(
      'rel="canonical" href="https://polls.example.test/"',
    );
    expect(html).not.toContain('name="robots" content="noindex"');
    expect(response.headers.get("x-robots-tag")).toBeNull();
    expect(html).toContain('data-smoke-marker="oddspark-token-solar"');
    expect(html).toContain(`data-token-solar="${solarHex}"`);
    expect(html).toContain("Best day for a long weekend?");
    expect(html.indexOf("Friday")).toBeLessThan(html.indexOf("Monday"));
    expect(html.indexOf("Monday")).toBeLessThan(html.indexOf("Either works"));
    expect(html).toContain("No Votes yet. Yours would be the first, which is a kind of power.");
    expect(html).toContain("ONE VOTE PER BROWSER");
    expect(html).toContain("HUMAN CHECK ON SUBMIT");
    expect(html).not.toContain("ONE VOTE PER NETWORK");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("rejects unsupported methods with an explicit GET, HEAD, and POST allowance", async () => {
    const response = await render(
      new Request(`${ORIGIN}/`, { method: "PUT", headers: {
        origin: ORIGIN,
        "sec-fetch-site": "same-origin",
      } }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD, POST");
    expect(await response.text()).toBe("Method not allowed.");
  });

  it("serves HEAD without a body and rejects cross-origin POST before delivery", async () => {
    const head = await render(new Request(`${ORIGIN}/`, { method: "HEAD" }));
    expect(head.status).toBe(200);
    expect(head.headers.get("cache-control")).toBe("private, no-store");
    expect(await head.text()).toBe("");

    const rejected = await render(new Request(`${ORIGIN}/`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin: "https://attacker.example",
        "sec-fetch-site": "cross-site",
      },
      body: new URLSearchParams({
        submission_id: crypto.randomUUID(),
        option_id: currentDemo.optionId,
        "cf-turnstile-response": "never-reaches-delivery",
      }),
    }));
    expect(rejected.status).toBe(403);
    expect(await rejected.text()).toBe("Forbidden");
    const count = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM vote WHERE poll_id = ?1",
    ).bind(currentDemo.pollId).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it.each([
    ["malformed binding", async () => { mutableEnv.DEMO_POLL_REFERENCE = "Demo"; }],
    ["unresolved binding", async () => {
      await testEnv.DB.prepare("DELETE FROM poll_reference WHERE reference = 'demo'").run();
    }],
    ["definition drift", async () => {
      await testEnv.DB.prepare("UPDATE poll SET question = 'Drifted' WHERE id = ?1")
        .bind(currentDemo.pollId).run();
    }],
  ])("renders the exact private operational state for %s", async (_label, arrange) => {
    await arrange();
    const response = await render(new Request(`${ORIGIN}/`));
    const html = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(html).toContain("Demo unavailable — Oddspark Polls");
    expect(html).toContain("DEMO UNAVAILABLE");
    expect(html).toContain(
      "The live Demo is unavailable right now. The rest of Oddspark Polls is still here.",
    );
    expect(html).toContain("TRY AGAIN");
    expect(html).not.toContain("Drifted");
  });

  it("casts through the real root POST, redirects to root, and returns live Counted truth", async () => {
    const first = await render(new Request(`${VOTE_ORIGIN}/`));
    const html = await first.text();
    const submissionId = /name="submission_id" value="([^"]+)"/.exec(html)?.[1];
    const optionId = /name="option_id" value="([^"]+)"/.exec(html)?.[1];
    expect(submissionId).toBeTruthy();
    expect(optionId).toBeTruthy();
    const voterCookie = cookieValue(first, VOTER_COOKIE_NAME);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      action: "vote",
      hostname: "127.0.0.1",
    }), { status: 200 }));

    const response = await render(new Request(`${VOTE_ORIGIN}/`, {
      method: "POST",
      headers: {
        cookie: voterCookie,
        "content-type": "application/x-www-form-urlencoded",
        origin: VOTE_ORIGIN,
        "sec-fetch-site": "same-origin",
        "cf-connecting-ip": "203.0.113.44",
      },
      body: new URLSearchParams({
        submission_id: submissionId ?? "",
        option_id: optionId ?? "",
        "cf-turnstile-response": "controlled-test-token",
      }),
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    const flash = cookieValue(response, "oddspark.vote_flash");

    const counted = await render(new Request(`${VOTE_ORIGIN}/`, {
      headers: { cookie: `${voterCookie}; ${flash}` },
    }));
    const countedHtml = await counted.text();
    expect(countedHtml).toContain("Counted.");
    expect(countedHtml).toContain("Results are live, updating as they arrive.");
    expect(countedHtml).toContain('data-count="1"');

    const returning = await render(new Request(`${VOTE_ORIGIN}/`, {
      headers: { cookie: voterCookie },
    }));
    const returningHtml = await returning.text();
    expect(returningHtml).toContain("You&#39;ve already voted here.");
    expect(returningHtml).toContain('data-count="1"');
  });

  it("fails closed on Turnstile rejection while preserving the selected option", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: false,
      "error-codes": ["invalid-input-response"],
    }), { status: 200 }));
    const ballot = await freshBallot();
    const response = await submitBallot(ballot, "rejected-token");
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toContain('data-outcome-code="captcha_failed"');
    expect(html).toContain(`value="${ballot.optionId}" checked`);
    const row = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM vote WHERE poll_id = ?1",
    ).bind(currentDemo.pollId).first<{ count: number }>();
    expect(row?.count).toBe(0);
  });

  it("replays a lost accepted response idempotently without reusing Siteverify", async () => {
    const siteverify = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({
        success: true,
        action: "vote",
        hostname: "127.0.0.1",
      }), { status: 200 }),
    );
    const ballot = await freshBallot();

    expect((await submitBallot(ballot, "single-use-token")).status).toBe(303);
    expect((await submitBallot(ballot, "single-use-token")).status).toBe(303);
    expect(siteverify).toHaveBeenCalledTimes(1);
    const row = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM vote WHERE poll_id = ?1",
    ).bind(currentDemo.pollId).first<{ count: number }>();
    expect(row?.count).toBe(1);
  });

  it("rejects a provider-reported duplicate token on a different submission", async () => {
    const siteverify = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: true,
        action: "vote",
        hostname: "127.0.0.1",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        success: false,
        "error-codes": ["timeout-or-duplicate"],
      }), { status: 200 }));
    const first = await freshBallot();
    const second = await freshBallot();

    expect((await submitBallot(first, "provider-token")).status).toBe(303);
    const duplicate = await submitBallot(second, "provider-token");
    expect(duplicate.status).toBe(422);
    expect(await duplicate.text()).toContain('data-outcome-code="captcha_failed"');
    expect(siteverify).toHaveBeenCalledTimes(2);
    const row = await testEnv.DB.prepare(
      "SELECT COUNT(*) AS count FROM vote WHERE poll_id = ?1",
    ).bind(currentDemo.pollId).first<{ count: number }>();
    expect(row?.count).toBe(1);
  });
});
