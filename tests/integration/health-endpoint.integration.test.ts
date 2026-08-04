import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "../../src/pages/api/health";

// The endpoint reads the worker env directly (cloudflare:workers), so the
// missing-binding case is simulated by blanking the binding on the shared
// test env and restoring it afterwards.
const mutableEnv = env as unknown as Record<string, unknown>;
const originalDigestSecret = env.VOTE_DIGEST_SECRET;
const originalTurnstileSecret = env.TURNSTILE_SECRET_KEY;
const originalTurnstileSiteKey = env.TURNSTILE_SITE_KEY;
const originalDemoPollReference = env.DEMO_POLL_REFERENCE;

afterEach(() => {
  mutableEnv.VOTE_DIGEST_SECRET = originalDigestSecret;
  mutableEnv.TURNSTILE_SECRET_KEY = originalTurnstileSecret;
  mutableEnv.TURNSTILE_SITE_KEY = originalTurnstileSiteKey;
  mutableEnv.DEMO_POLL_REFERENCE = originalDemoPollReference;
});

describe("GET /api/health", () => {
  it("reports ok when every binding voting needs is present", async () => {
    const response = await GET(
      {} as unknown as Parameters<typeof GET>[0],
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("fails loud naming the missing binding — never its value", async () => {
    mutableEnv.VOTE_DIGEST_SECRET = undefined;

    const response = await GET(
      {} as unknown as Parameters<typeof GET>[0],
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ ok: false, missing: ["VOTE_DIGEST_SECRET"] });
    expect(JSON.stringify(body)).not.toContain(String(originalDigestSecret));
  });

  it("treats a blank digest secret as missing", async () => {
    mutableEnv.VOTE_DIGEST_SECRET = "   ";

    const response = await GET(
      {} as unknown as Parameters<typeof GET>[0],
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      missing: ["VOTE_DIGEST_SECRET"],
    });
  });

  it("names a missing Turnstile secret without returning its value", async () => {
    mutableEnv.TURNSTILE_SECRET_KEY = undefined;

    const response = await GET(
      {} as unknown as Parameters<typeof GET>[0],
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ ok: false, missing: ["TURNSTILE_SECRET_KEY"] });
    expect(JSON.stringify(body)).not.toContain(String(originalTurnstileSecret));
  });

  it("names a blank Turnstile site key", async () => {
    mutableEnv.TURNSTILE_SITE_KEY = "  ";

    const response = await GET(
      {} as unknown as Parameters<typeof GET>[0],
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      missing: ["TURNSTILE_SITE_KEY"],
    });
  });

  it("names a missing Demo reference without disclosing its configured value", async () => {
    mutableEnv.DEMO_POLL_REFERENCE = undefined;

    const response = await GET({} as unknown as Parameters<typeof GET>[0]);

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ ok: false, missing: ["DEMO_POLL_REFERENCE"] });
    expect(JSON.stringify(body)).not.toContain(String(originalDemoPollReference));
  });
});
