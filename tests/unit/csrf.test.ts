import { describe, expect, it } from "vitest";
import {
  createSessionCsrfToken,
  checkCsrf,
  CSRF_FORM_FIELD_NAME,
  CSRF_HEADER_NAME,
  isBetterAuthMountPath,
} from "../../src/lib/csrf";

describe("csrf boundary", () => {
  const sameOriginUrl = "https://polls.oddspark.dev/vote";

  it("allows safe methods without origin checks", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      const result = checkCsrf({
        method,
        url: sameOriginUrl,
        origin: "https://evil.example",
        secFetchSite: "cross-site",
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.reason).toBe("safe_method");
    }
  });

  it("rejects cross-origin POST via Sec-Fetch-Site", () => {
    const result = checkCsrf({
      method: "POST",
      url: sameOriginUrl,
      origin: "https://evil.example",
      secFetchSite: "cross-site",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("cross_origin");
  });

  it("rejects cross-origin POST via Origin header", () => {
    const result = checkCsrf({
      method: "POST",
      url: sameOriginUrl,
      origin: "https://evil.example",
      secFetchSite: null,
    });
    expect(result.ok).toBe(false);
  });

  it("allows same-origin POST", () => {
    const result = checkCsrf({
      method: "POST",
      url: sameOriginUrl,
      origin: "https://polls.oddspark.dev",
      secFetchSite: "same-origin",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reason).toBe("same_origin");
  });

  it("rejects state-changing requests with no origin metadata", () => {
    const result = checkCsrf({
      method: "POST",
      url: sameOriginUrl,
      origin: null,
      secFetchSite: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("missing_origin_metadata");
  });

  it("allows same-origin POST via Fetch Metadata alone (no Origin header)", () => {
    const result = checkCsrf({
      method: "POST",
      url: sameOriginUrl,
      origin: null,
      secFetchSite: "same-origin",
    });
    expect(result.ok).toBe(true);
  });

  it("allows POST with sec-fetch-site: none (user-initiated navigation)", () => {
    const result = checkCsrf({
      method: "POST",
      url: sameOriginUrl,
      origin: null,
      secFetchSite: "none",
    });
    expect(result.ok).toBe(true);
  });

  it("fails closed on unrecognized Sec-Fetch-Site values", () => {
    for (const bogus of ["", "garbage", "SAME-ORIGIN "]) {
      const result = checkCsrf({
        method: "POST",
        url: sameOriginUrl,
        origin: null,
        secFetchSite: bogus,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("missing_origin_metadata");
    }
  });

  it('treats literal "null" Origin as absent (opaque origins rely on Fetch Metadata)', () => {
    const result = checkCsrf({
      method: "POST",
      url: sameOriginUrl,
      origin: "null",
      secFetchSite: "same-origin",
    });
    expect(result.ok).toBe(true);
  });

  it("pass-through only for Better Auth mount path", () => {
    expect(isBetterAuthMountPath("/api/auth")).toBe(true);
    expect(isBetterAuthMountPath("/api/auth/callback/google")).toBe(true);
    expect(isBetterAuthMountPath("/api/vote")).toBe(false);

    const result = checkCsrf({
      method: "POST",
      url: "https://polls.oddspark.dev/api/auth/sign-in",
      origin: "https://evil.example",
      secFetchSite: "cross-site",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.reason).toBe("better_auth_pass_through");
  });

  it("session CSRF token hook rejects mismatch when required", () => {
    const result = checkCsrf({
      method: "POST",
      url: sameOriginUrl,
      origin: "https://polls.oddspark.dev",
      secFetchSite: "same-origin",
      requireSessionToken: true,
      csrfToken: "a",
      expectedCsrfToken: "b",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("csrf_token_mismatch");
  });

  it("issues a deterministic token bound to one session", async () => {
    const first = await createSessionCsrfToken(
      "session-1",
      "csrf-secret-at-least-32-characters",
    );
    const again = await createSessionCsrfToken(
      "session-1",
      "csrf-secret-at-least-32-characters",
    );
    const otherSession = await createSessionCsrfToken(
      "session-2",
      "csrf-secret-at-least-32-characters",
    );

    expect(first).toEqual(again);
    expect(first.value).not.toBe(otherSession.value);
    expect(first.headerName).toBe(CSRF_HEADER_NAME);
    expect(first.formFieldName).toBe(CSRF_FORM_FIELD_NAME);
  });

  it("accepts real issuance and rejects a token from another session", async () => {
    const current = await createSessionCsrfToken(
      "session-1",
      "csrf-secret-at-least-32-characters",
    );
    const other = await createSessionCsrfToken(
      "session-2",
      "csrf-secret-at-least-32-characters",
    );
    const base = {
      method: "POST",
      url: sameOriginUrl,
      origin: "https://polls.oddspark.dev",
      secFetchSite: "same-origin",
      requireSessionToken: true,
      expectedCsrfToken: current.value,
    };

    expect(checkCsrf({ ...base, csrfToken: current.value }).ok).toBe(true);
    const rejected = checkCsrf({ ...base, csrfToken: other.value });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe("csrf_token_mismatch");
  });
});
