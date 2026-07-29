import { describe, expect, it, vi } from "vitest";
import { checkCsrf } from "../../src/lib/csrf";
import {
  emitTelemetry,
  type TelemetryRecord,
} from "../../src/adapters/telemetry/index";
import { onRequest } from "../../src/middleware";

/**
 * Integration-tier tests for CSRF + telemetry running under workerd
 * (@cloudflare/vitest-pool-workers). Pure policy functions exercise the same
 * boundary the middleware uses before any handler runs.
 */
describe("csrf delivery boundary (workerd)", () => {
  it("rejects cross-origin POST", () => {
    const result = checkCsrf({
      method: "POST",
      url: "https://oddspark-polls-staging.example.workers.dev/vote",
      origin: "https://attacker.example",
      secFetchSite: "cross-site",
    });
    expect(result.ok).toBe(false);
  });

  it("allows same-origin POST", () => {
    const result = checkCsrf({
      method: "POST",
      url: "https://oddspark-polls-staging.example.workers.dev/vote",
      origin: "https://oddspark-polls-staging.example.workers.dev",
      secFetchSite: "same-origin",
    });
    expect(result.ok).toBe(true);
  });

  it("leaves GET unaffected", () => {
    const result = checkCsrf({
      method: "GET",
      url: "https://oddspark-polls-staging.example.workers.dev/",
      origin: "https://attacker.example",
      secFetchSite: "cross-site",
    });
    expect(result.ok).toBe(true);
  });

  it("emits structured telemetry inside workerd", () => {
    const record: TelemetryRecord = {
      requestId: crypto.randomUUID(),
      operation: "integration.csrf",
      result: "csrf_rejected",
      durationMs: 1,
      providerOutcome: "none",
    };
    // Must not throw in Workers runtime
    expect(() => emitTelemetry(record)).not.toThrow();
  });
});

/**
 * The actual middleware chain (request-context → CSRF → telemetry) invoked
 * end-to-end. This proves the wiring the pure-function tests above rely on:
 * rejection before any handler runs, and one telemetry record per operation.
 */
describe("delivery middleware chain (workerd)", () => {
  type Ctx = Parameters<typeof onRequest>[0];

  function makeContext(request: Request): Ctx {
    return { request, locals: {} } as unknown as Ctx;
  }

  const passThrough = async () => new Response("handler-ok");

  it("rejects cross-origin POST before the handler runs", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    let handlerRan = false;
    try {
      const res = (await onRequest(
        makeContext(
          new Request("https://staging.example/vote", {
            method: "POST",
            headers: {
              origin: "https://evil.example",
              "sec-fetch-site": "cross-site",
            },
          }),
        ),
        (async () => {
          handlerRan = true;
          return new Response("handler-ok");
        }) as never,
      )) as Response;
      expect(res.status).toBe(403);
      expect(handlerRan).toBe(false);
      expect(res.headers.get("x-request-id")).toBeTruthy();
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("passes same-origin POST to the handler and tags x-request-id", async () => {
    const res = (await onRequest(
      makeContext(
        new Request("https://staging.example/vote", {
          method: "POST",
          headers: {
            origin: "https://staging.example",
            "sec-fetch-site": "same-origin",
          },
        }),
      ),
      passThrough as never,
    )) as Response;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("handler-ok");
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("leaves cross-origin GET unaffected", async () => {
    const res = (await onRequest(
      makeContext(
        new Request("https://staging.example/", {
          headers: { origin: "https://evil.example" },
        }),
      ),
      passThrough as never,
    )) as Response;
    expect(res.status).toBe(200);
  });

  it("emits an error telemetry record even when the handler throws", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await expect(
        onRequest(
          makeContext(
            new Request("https://staging.example/boom", {
              method: "POST",
              headers: { "sec-fetch-site": "same-origin" },
            }),
          ),
          (async () => {
            throw new Error("boom");
          }) as never,
        ),
      ).rejects.toThrow("boom");
      const records = spy.mock.calls.map((c) => JSON.parse(String(c[0])));
      expect(
        records.some((r) => r.operation === "POST /boom" && r.result === "error"),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("records a creator guard redirect as exactly one operation", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const response = (await onRequest(
        makeContext(new Request("https://staging.example/creator")),
        passThrough as never,
      )) as Response;

      expect(response.status).toBe(303);
      expect(response.headers.get("x-request-id")).toBeTruthy();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(spy.mock.calls[0]?.[0]))).toEqual(
        expect.objectContaining({
          operation: "GET /creator",
          result: "ok",
        }),
      );
    } finally {
      spy.mockRestore();
    }
  });
});
