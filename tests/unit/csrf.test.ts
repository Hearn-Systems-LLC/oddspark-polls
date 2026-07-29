import { describe, expect, it } from "vitest";
import {
  checkCsrf,
  createSessionCsrfTokenStub,
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

  it("exposes session token stub contract for Story 1.2", () => {
    const stub = createSessionCsrfTokenStub();
    expect(stub.headerName).toBe("X-CSRF-Token");
    expect(stub.formFieldName).toBe("csrf_token");
  });
});
