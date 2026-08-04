import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../../src/middleware";
import Landing from "../../src/pages/index.astro";

type MiddlewareContext = Parameters<typeof onRequest>[0];
type TestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };
const testEnv = env as TestEnv;

beforeEach(async () => {
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
  await testEnv.DB.prepare("DELETE FROM poll").run();
  await testEnv.DB.prepare("DELETE FROM user").run();
  const now = Date.now();
  const pollId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  const options = ["Friday", "Monday", "Either works"];
  await testEnv.DB.batch([
    testEnv.DB.prepare(
      "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?1, 'Telemetry Demo', 'telemetry-demo@example.test', 1, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z')",
    ).bind(ownerId),
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
    ).bind(pollId, ownerId, now),
    ...options.map((label, position) =>
      testEnv.DB.prepare(
        "INSERT INTO poll_option (id, poll_id, label, position, created_at_ms) VALUES (?1, ?2, ?3, ?4, ?5)",
      ).bind(crypto.randomUUID(), pollId, label, position, now),
    ),
    testEnv.DB.prepare(
      "INSERT INTO poll_reference (reference, poll_id, kind, is_canonical, created_at_ms) VALUES ('demo', ?1, 'custom', 1, ?2)",
    ).bind(pollId, now),
  ]);
});

function makeContext(request: Request): MiddlewareContext {
  return { request, locals: {} } as unknown as MiddlewareContext;
}

async function dispatch(request: Request): Promise<Response> {
  const context = makeContext(request);
  const container = await AstroContainer.create();
  return (await onRequest(
    context,
    (() =>
      container.renderToResponse(Landing, {
        request: context.request,
        locals: context.locals,
      })) as never,
  )) as Response;
}

describe("landing delivery middleware chain", () => {
  it("tags the root response and emits exactly one matching telemetry record", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const response = await dispatch(new Request("https://polls.example.test/"));
      const requestId = response.headers.get("x-request-id");

      expect(response.status).toBe(200);
      expect(requestId).toBeTruthy();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual(
        expect.objectContaining({
          requestId,
          operation: "GET /",
          result: "ok",
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("emits one generic Demo-unavailable result with the matching request ID", async () => {
    const mutableEnv = testEnv as unknown as Record<string, unknown>;
    const originalReference = testEnv.DEMO_POLL_REFERENCE;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    mutableEnv.DEMO_POLL_REFERENCE = "Invalid Reference";
    try {
      const response = await dispatch(new Request("https://polls.example.test/"));
      const requestId = response.headers.get("x-request-id");
      const body = await response.text();

      expect(response.status).toBe(503);
      expect(requestId).toBeTruthy();
      expect(body).toContain("DEMO UNAVAILABLE");
      expect(body).not.toContain("Invalid Reference");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual(
        expect.objectContaining({
          requestId,
          operation: "GET /",
          result: "demo_unavailable",
          pollId: null,
        }),
      );
    } finally {
      mutableEnv.DEMO_POLL_REFERENCE = originalReference;
      spy.mockRestore();
    }
  });
});
