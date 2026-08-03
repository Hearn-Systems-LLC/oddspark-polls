import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TURNSTILE_ALWAYS_PASS_SITE_KEY,
  extractTurnstileToken,
  verifyTurnstileToken,
} from "../../src/adapters/turnstile/index";

const REAL_SITE_KEY = "0x4AAAAAAEFT53x0EwB5qscd";
const SECRET = "test-turnstile-secret";
const TOKEN = "opaque-token-value";
const SUBMISSION_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function jsonResponse(
  body: unknown,
  init: { status?: number; oversized?: boolean } = {},
): Response {
  if (init.oversized) {
    const big = "x".repeat(16 * 1024 + 1);
    return new Response(big, {
      status: init.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json" },
  });
}

describe("extractTurnstileToken", () => {
  it("accepts exactly one well-formed opaque token", () => {
    expect(extractTurnstileToken([TOKEN])).toBe(TOKEN);
  });

  it("rejects missing, empty, whitespace, File, duplicate, and oversized fields", () => {
    expect(extractTurnstileToken([])).toBeNull();
    expect(extractTurnstileToken([""])).toBeNull();
    expect(extractTurnstileToken(["   "])).toBeNull();
    expect(extractTurnstileToken([new File(["x"], "x.txt")])).toBeNull();
    expect(extractTurnstileToken([TOKEN, TOKEN])).toBeNull();
    expect(extractTurnstileToken(["a".repeat(2049)])).toBeNull();
  });

  it("does not trim an otherwise valid token", () => {
    const padded = ` ${TOKEN}`;
    expect(extractTurnstileToken([padded])).toBe(padded);
  });
});

describe("verifyTurnstileToken", () => {
  it("skips the provider for locally invalid token shapes", async () => {
    const fetchImpl = vi.fn();
    const result = await verifyTurnstileToken({
      responseFields: [],
      secret: SECRET,
      siteKey: REAL_SITE_KEY,
      hostname: "localhost",
      submissionId: SUBMISSION_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ proof: "failed", providerOutcome: "skipped" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when the secret binding is missing", async () => {
    const fetchImpl = vi.fn();
    const result = await verifyTurnstileToken({
      responseFields: [TOKEN],
      secret: undefined,
      siteKey: REAL_SITE_KEY,
      hostname: "localhost",
      submissionId: SUBMISSION_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ proof: "failed", providerOutcome: "error" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs secret, response, and submission idempotency_key without remoteip", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(_url).toBe(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      );
      expect(init?.method).toBe("POST");
      const body = String(init?.body);
      expect(body).toContain(`secret=${encodeURIComponent(SECRET)}`);
      expect(body).toContain(`response=${encodeURIComponent(TOKEN)}`);
      expect(body).toContain(
        `idempotency_key=${encodeURIComponent(SUBMISSION_ID)}`,
      );
      expect(body).not.toContain("remoteip");
      return jsonResponse({
        success: true,
        action: "vote",
        hostname: "polls.example.test",
      });
    });

    const result = await verifyTurnstileToken({
      responseFields: [TOKEN],
      secret: SECRET,
      siteKey: REAL_SITE_KEY,
      hostname: "polls.example.test",
      submissionId: SUBMISSION_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result).toEqual({ proof: "passed", providerOutcome: "ok" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("accepts success with action and hostname matches for real site keys", async () => {
    const result = await verifyTurnstileToken({
      responseFields: [TOKEN],
      secret: SECRET,
      siteKey: REAL_SITE_KEY,
      hostname: "oddspark-polls-staging.hearnsystems.workers.dev",
      submissionId: SUBMISSION_ID,
      fetchImpl: (async () =>
        jsonResponse({
          success: true,
          action: "vote",
          hostname: "oddspark-polls-staging.hearnsystems.workers.dev",
        })) as typeof fetch,
    });
    expect(result.proof).toBe("passed");
  });

  it("rejects success false, action mismatch, hostname mismatch, and missing metadata", async () => {
    const cases = [
      { success: false, action: "vote", hostname: "localhost" },
      { success: true, action: "login", hostname: "localhost" },
      { success: true, action: "vote", hostname: "evil.example" },
      { success: true },
    ];
    for (const body of cases) {
      const result = await verifyTurnstileToken({
        responseFields: [TOKEN],
        secret: SECRET,
        siteKey: REAL_SITE_KEY,
        hostname: "localhost",
        submissionId: SUBMISSION_ID,
        fetchImpl: (async () => jsonResponse(body)) as typeof fetch,
      });
      expect(result).toEqual({ proof: "failed", providerOutcome: "error" });
    }
  });

  it("relaxes only action/hostname metadata for the always-pass test key on loopback", async () => {
    for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
      const result = await verifyTurnstileToken({
        responseFields: [TOKEN],
        secret: SECRET,
        siteKey: TURNSTILE_ALWAYS_PASS_SITE_KEY,
        hostname,
        submissionId: SUBMISSION_ID,
        fetchImpl: (async () =>
          jsonResponse({ success: true })) as typeof fetch,
      });
      expect(result).toEqual({ proof: "passed", providerOutcome: "ok" });
    }
  });

  it("fails the always-pass test key on remote hostnames even when success is true", async () => {
    const result = await verifyTurnstileToken({
      responseFields: [TOKEN],
      secret: SECRET,
      siteKey: TURNSTILE_ALWAYS_PASS_SITE_KEY,
      hostname: "oddspark-polls-staging.hearnsystems.workers.dev",
      submissionId: SUBMISSION_ID,
      fetchImpl: (async () =>
        jsonResponse({
          success: true,
          action: "vote",
          hostname: "oddspark-polls-staging.hearnsystems.workers.dev",
        })) as typeof fetch,
    });
    expect(result).toEqual({ proof: "failed", providerOutcome: "error" });
  });

  it("never relaxes metadata for a real site key on loopback without matches", async () => {
    const result = await verifyTurnstileToken({
      responseFields: [TOKEN],
      secret: SECRET,
      siteKey: REAL_SITE_KEY,
      hostname: "localhost",
      submissionId: SUBMISSION_ID,
      fetchImpl: (async () =>
        jsonResponse({ success: true })) as typeof fetch,
    });
    expect(result).toEqual({ proof: "failed", providerOutcome: "error" });
  });

  it("rejects non-2xx, malformed JSON, oversized bodies, and thrown fetch", async () => {
    await expect(
      verifyTurnstileToken({
        responseFields: [TOKEN],
        secret: SECRET,
        siteKey: REAL_SITE_KEY,
        hostname: "localhost",
        submissionId: SUBMISSION_ID,
        fetchImpl: (async () =>
          jsonResponse({ success: true }, { status: 503 })) as typeof fetch,
      }),
    ).resolves.toEqual({ proof: "failed", providerOutcome: "error" });

    await expect(
      verifyTurnstileToken({
        responseFields: [TOKEN],
        secret: SECRET,
        siteKey: REAL_SITE_KEY,
        hostname: "localhost",
        submissionId: SUBMISSION_ID,
        fetchImpl: (async () =>
          new Response("not-json", { status: 200 })) as typeof fetch,
      }),
    ).resolves.toEqual({ proof: "failed", providerOutcome: "error" });

    await expect(
      verifyTurnstileToken({
        responseFields: [TOKEN],
        secret: SECRET,
        siteKey: REAL_SITE_KEY,
        hostname: "localhost",
        submissionId: SUBMISSION_ID,
        fetchImpl: (async () =>
          jsonResponse(null, { oversized: true })) as typeof fetch,
      }),
    ).resolves.toEqual({ proof: "failed", providerOutcome: "error" });

    await expect(
      verifyTurnstileToken({
        responseFields: [TOKEN],
        secret: SECRET,
        siteKey: REAL_SITE_KEY,
        hostname: "localhost",
        submissionId: SUBMISSION_ID,
        fetchImpl: (async () => {
          throw new TypeError("network down");
        }) as typeof fetch,
      }),
    ).resolves.toEqual({ proof: "failed", providerOutcome: "error" });
  });

  it("aborts the whole attempt within five seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            return;
          }
          signal.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );

    const pending = verifyTurnstileToken({
      responseFields: [TOKEN],
      secret: SECRET,
      siteKey: REAL_SITE_KEY,
      hostname: "localhost",
      submissionId: SUBMISSION_ID,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(pending).resolves.toEqual({
      proof: "failed",
      providerOutcome: "timeout",
    });
  });

  it("never includes secret or token material in thrown results", async () => {
    const result = await verifyTurnstileToken({
      responseFields: [TOKEN],
      secret: SECRET,
      siteKey: REAL_SITE_KEY,
      hostname: "localhost",
      submissionId: SUBMISSION_ID,
      fetchImpl: (async () => {
        throw new Error(`leaked ${SECRET} ${TOKEN}`);
      }) as typeof fetch,
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

