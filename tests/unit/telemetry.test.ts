import { describe, expect, it, vi, afterEach } from "vitest";
import {
  classifyAuthProviderOutcome,
  emitTelemetry,
  isForbiddenTelemetryKey,
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
    };

    emitTelemetry(hostile);

    const raw = String(spy.mock.calls[0]?.[0]);
    expect(raw).not.toContain("secret-should-not-appear");
    expect(raw).not.toContain("ABC123");
    expect(raw).not.toContain("token");
    expect(raw).not.toContain("voterCode");
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
});
