import { describe, expect, it, vi, afterEach } from "vitest";
import {
  classifyAuthProviderOutcome,
  emitTelemetry,
  isForbiddenTelemetryKey,
  resolveProviderOutcome,
  telemetryOperationForRoute,
  telemetryResultForStatus,
  type TelemetryRecord,
} from "../../src/adapters/telemetry/index";

describe("telemetry adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emits a record with exactly the six allowed fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const record: TelemetryRecord = {
      requestId: "req-test-1",
      operation: "csrf.check",
      result: "ok",
      durationMs: 12,
      providerOutcome: "none",
      pollId: "poll-123",
    };

    emitTelemetry(record);

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(spy.mock.calls[0]?.[0]));
    expect(Object.keys(payload).sort()).toEqual(
      [
        "durationMs",
        "operation",
        "pollId",
        "providerOutcome",
        "requestId",
        "result",
      ].sort(),
    );
    expect(payload).toEqual(record);
  });

  it("rejects forbidden field names by construction (type + runtime helper)", () => {
    expect(isForbiddenTelemetryKey("token")).toBe(true);
    expect(isForbiddenTelemetryKey("tokens")).toBe(true);
    expect(isForbiddenTelemetryKey("voterDigest")).toBe(true);
    expect(isForbiddenTelemetryKey("comment")).toBe(true);
    expect(isForbiddenTelemetryKey("ballot")).toBe(true);
    expect(isForbiddenTelemetryKey("voterCode")).toBe(true);
    expect(isForbiddenTelemetryKey("ip")).toBe(true);
    expect(isForbiddenTelemetryKey("ipAddress")).toBe(true);
    expect(isForbiddenTelemetryKey("ip_address")).toBe(true);
    expect(isForbiddenTelemetryKey("clientIp")).toBe(true);
    expect(isForbiddenTelemetryKey("cfConnectingIp")).toBe(true);
    expect(isForbiddenTelemetryKey("digest")).toBe(true);
    expect(isForbiddenTelemetryKey("ipDigest")).toBe(true);
    expect(isForbiddenTelemetryKey("cf-turnstile-response")).toBe(true);
    expect(isForbiddenTelemetryKey("cfTurnstileResponse")).toBe(true);
    expect(isForbiddenTelemetryKey("turnstileToken")).toBe(true);
    expect(isForbiddenTelemetryKey("turnstile_token")).toBe(true);
    expect(isForbiddenTelemetryKey("TURNSTILE_SECRET_KEY")).toBe(true);
    expect(isForbiddenTelemetryKey("error-codes")).toBe(true);
    expect(isForbiddenTelemetryKey("requestId")).toBe(false);
    expect(isForbiddenTelemetryKey("operation")).toBe(false);
  });

  it("does not log forbidden keys even if caller spreads extra properties at runtime", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    // Simulate a hostile/incorrect call: only TelemetryRecord fields are copied.
    const hostile = {
      requestId: "req-2",
      operation: "vote.cast",
      result: "ok" as const,
      durationMs: 5,
      providerOutcome: "ok" as const,
      pollId: "poll-456",
      token: "secret-should-not-appear",
      voterCode: "ABC123",
      ip: "203.0.113.8",
      ipAddress: "203.0.113.8",
      clientIp: "203.0.113.8",
      cfConnectingIp: "203.0.113.8",
      digest: "a".repeat(64),
      ipDigest: "b".repeat(64),
      // Story 2.3: Turnstile challenge material must never reach telemetry.
      "cf-turnstile-response": "turnstile-token-value",
      turnstileToken: "turnstile-token-value",
      TURNSTILE_SECRET_KEY: "secret-value",
      "error-codes": '["invalid-input-response"]',
    };

    emitTelemetry(hostile);

    const raw = String(spy.mock.calls[0]?.[0]);
    expect(raw).not.toContain("secret-should-not-appear");
    expect(raw).not.toContain("ABC123");
    expect(raw).not.toContain("token");
    expect(raw).not.toContain("voterCode");
    expect(raw).not.toContain("203.0.113.8");
    expect(raw).not.toContain("a".repeat(64));
    expect(raw).not.toContain("b".repeat(64));
    expect(raw).not.toContain('"ip"');
    expect(raw).not.toContain("ipAddress");
    expect(raw).not.toContain("digest");
    expect(raw).not.toContain("turnstile-token-value");
    expect(raw).not.toContain("secret-value");
    expect(raw).not.toContain("cf-turnstile-response");
    expect(raw).not.toContain("cfTurnstileResponse");
    expect(raw).not.toContain("turnstileToken");
    expect(raw).not.toContain("TURNSTILE_SECRET_KEY");
    expect(raw).not.toContain("error-codes");
  });

  it("classifies auth initiation and callback outcomes without logging payloads", () => {
    expect(
      classifyAuthProviderOutcome("/api/sign-in", 303, "https://github.com/login"),
    ).toBe("ok");
    expect(
      classifyAuthProviderOutcome(
        "/api/auth/callback/google",
        302,
        "/creator?outcome=signed-in",
      ),
    ).toBe("ok");
    expect(
      classifyAuthProviderOutcome(
        "/api/auth/callback/github",
        302,
        "/sign-in?outcome=denied&error=access_denied",
      ),
    ).toBe("error");
    expect(
      classifyAuthProviderOutcome("/api/auth/callback/google", 500, null),
    ).toBe("error");
    expect(classifyAuthProviderOutcome("/creator", 200, null)).toBe("none");
  });

  it("emits the one generic Demo unavailable result before generic 5xx classification", () => {
    expect(
      telemetryResultForStatus(503, { demoUnavailable: true }),
    ).toBe("demo_unavailable");
  });

  it("prefers a Turnstile provider-outcome override over auth classification", () => {
    expect(
      resolveProviderOutcome("/some-poll", 422, null, "timeout"),
    ).toBe("timeout");
    expect(resolveProviderOutcome("/some-poll", 303, null, "ok")).toBe("ok");
    expect(
      resolveProviderOutcome("/some-poll", 422, null, "skipped"),
    ).toBe("skipped");
    expect(resolveProviderOutcome("/api/sign-in", 303, "/x", "none")).toBe(
      "ok",
    );
  });

  it("keeps auth classification when the override is none", () => {
    expect(
      resolveProviderOutcome(
        "/api/auth/callback/google",
        500,
        null,
        "none",
      ),
    ).toBe("error");
  });

  it.each([
    ["GET", "/Team-Lunch", true, "GET /:reference"],
    [
      "HEAD",
      "/GenRef-AbC123-xYz_9/results",
      true,
      "HEAD /:reference/results",
    ],
    ["GET", "/team-lunch/results/", true, "GET /:reference/results"],
    [
      "GET",
      "/team-lunch/results/live",
      true,
      "GET /:reference/results/live",
    ],
    [
      "HEAD",
      "/GenRef-AbC123-xYz_9/results/live/",
      true,
      "HEAD /:reference/results/live",
    ],
    ["GET", "/results", true, "GET /:reference"],
    ["POST", "/creator/new", false, "POST /creator/new"],
    [
      "GET",
      "/creator/moderation/",
      false,
      "GET /creator/moderation",
    ],
    [
      "GET",
      "/creator/polls/11111111-1111-4111-8111-111111111111",
      false,
      "GET /creator/polls/:pollId",
    ],
    [
      "POST",
      "/creator/polls/11111111-1111-4111-8111-111111111111",
      false,
      "POST /creator/polls/:pollId",
    ],
    [
      "GET",
      "/creator/polls/11111111-1111-4111-8111-111111111111/",
      false,
      "GET /creator/polls/:pollId",
    ],
    ["GET", "/creator/results", false, "GET /creator/results"],
  ])(
    "normalizes operation %s %s without obscuring static routes",
    (method, pathname, hasPollReferenceParam, expected) => {
      expect(
        telemetryOperationForRoute(method, pathname, hasPollReferenceParam),
      ).toBe(expected);
    },
  );

  it("never includes an internal creator Poll UUID in operation labels", () => {
    const pollId = "11111111-1111-4111-8111-111111111111";
    for (const method of ["GET", "POST"]) {
      expect(
        telemetryOperationForRoute(
          method,
          `/creator/polls/${pollId}`,
          false,
        ),
      ).not.toContain(pollId);
    }
  });

  it("keeps raw auth pathnames available for provider classification", () => {
    const pathname = "/api/auth/callback/google";

    expect(telemetryOperationForRoute("GET", pathname, false)).toBe(
      "GET /api/auth/callback/google",
    );
    expect(
      classifyAuthProviderOutcome(
        pathname,
        302,
        "/creator?outcome=signed-in",
      ),
    ).toBe("ok");
  });

  it("records flagged vote rejections (422) and rate limits (429) as errors, not ok", () => {
    expect(
      telemetryResultForStatus(422, { voteRejection: true }),
    ).toBe("error");
    expect(
      telemetryResultForStatus(429, { voteRejection: true }),
    ).toBe("error");
  });

  it("keeps an unflagged 422/429 (creator-surface validation) as ok", () => {
    expect(telemetryResultForStatus(422)).toBe("ok");
    expect(telemetryResultForStatus(429)).toBe("ok");
    expect(
      telemetryResultForStatus(422, { voteRejection: false }),
    ).toBe("ok");
  });

  it("classifies 403 only from explicit rejection flags with CSRF precedence", () => {
    expect(telemetryResultForStatus(403)).toBe("error");
    expect(
      telemetryResultForStatus(403, { csrfRejected: true }),
    ).toBe("csrf_rejected");
    expect(
      telemetryResultForStatus(403, { authorizationDenied: true }),
    ).toBe("authorization_denied");
    expect(
      telemetryResultForStatus(403, {
        csrfRejected: true,
        authorizationDenied: true,
      }),
    ).toBe("csrf_rejected");
  });

  it("keeps the existing 404/5xx result mapping unchanged", () => {
    expect(telemetryResultForStatus(404)).toBe("not_found");
    expect(telemetryResultForStatus(500)).toBe("error");
    expect(telemetryResultForStatus(502)).toBe("error");
  });

  it("records ordinary successes and redirects as ok", () => {
    expect(telemetryResultForStatus(200)).toBe("ok");
    expect(telemetryResultForStatus(301)).toBe("ok");
    expect(telemetryResultForStatus(303)).toBe("ok");
  });

  it("marks any status as an error when the session lookup itself failed", () => {
    expect(
      telemetryResultForStatus(200, { sessionLookupFailed: true }),
    ).toBe("error");
    expect(
      telemetryResultForStatus(404, { sessionLookupFailed: true }),
    ).toBe("error");
  });

  it("marks any status as an error when the Results lookup itself failed", () => {
    expect(
      telemetryResultForStatus(200, { resultsLookupFailed: true }),
    ).toBe("error");
    expect(
      telemetryResultForStatus(404, { resultsLookupFailed: true }),
    ).toBe("error");
  });
});
