import { describe, expect, it } from "vitest";
import { checkCsrf } from "../../src/lib/csrf";
import {
  emitTelemetry,
  type TelemetryRecord,
} from "../../src/adapters/telemetry/index";

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
