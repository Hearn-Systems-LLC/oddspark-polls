/**
 * CSRF delivery boundary (AD-22 / AR-18).
 *
 * State-changing requests must be same-origin via Origin and/or Sec-Fetch-Site.
 * Session-bound CSRF token hook is stubbed for Story 1.2 auth forms.
 *
 * Better Auth mount path pass-through: when auth is mounted (Story 1.2),
 * BETTER_AUTH_MOUNT_PATH requests keep Better Auth's own CSRF/OAuth-state
 * protections. That path is the only scoped pass-through — never a general bypass.
 * Capability routes always go through this middleware.
 */

export const BETTER_AUTH_MOUNT_PATH = "/api/auth";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export type CsrfCheckInput = {
  method: string;
  url: string;
  origin: string | null;
  secFetchSite: string | null;
  /** Optional session-bound token (Story 1.2). When provided and required, must match. */
  csrfToken?: string | null;
  expectedCsrfToken?: string | null;
  requireSessionToken?: boolean;
};

export type CsrfCheckResult =
  | { ok: true; reason: "safe_method" | "same_origin" | "better_auth_pass_through" }
  | { ok: false; reason: "cross_origin" | "missing_origin_metadata" | "csrf_token_mismatch" };

/**
 * Returns true when the request should skip the origin boundary because it
 * targets the future Better Auth mount. Full auth lands in Story 1.2.
 */
export function isBetterAuthMountPath(pathname: string): boolean {
  return (
    pathname === BETTER_AUTH_MOUNT_PATH ||
    pathname.startsWith(`${BETTER_AUTH_MOUNT_PATH}/`)
  );
}

function isSameOrigin(requestUrl: string, originHeader: string): boolean {
  try {
    const request = new URL(requestUrl);
    const origin = new URL(originHeader);
    return (
      request.protocol === origin.protocol &&
      request.host === origin.host
    );
  } catch {
    return false;
  }
}

/**
 * Evaluate CSRF / same-origin policy for a request.
 * Rejection must happen before any application handler runs.
 */
export function checkCsrf(input: CsrfCheckInput): CsrfCheckResult {
  const method = input.method.toUpperCase();

  if (SAFE_METHODS.has(method)) {
    return { ok: true, reason: "safe_method" };
  }

  let pathname = "/";
  try {
    pathname = new URL(input.url).pathname;
  } catch {
    pathname = "/";
  }

  // Scoped pass-through for Better Auth only (documented for Story 1.2).
  // Better Auth retains its own CSRF/OAuth-state protections.
  if (isBetterAuthMountPath(pathname)) {
    return { ok: true, reason: "better_auth_pass_through" };
  }

  const secFetchSite = input.secFetchSite?.toLowerCase() ?? null;
  const origin = input.origin;

  // Prefer Fetch Metadata when present.
  if (secFetchSite !== null) {
    if (secFetchSite === "same-origin" || secFetchSite === "none") {
      // continue to optional session token check
    } else if (secFetchSite === "same-site" || secFetchSite === "cross-site") {
      return { ok: false, reason: "cross_origin" };
    }
  }

  if (origin) {
    if (!isSameOrigin(input.url, origin)) {
      return { ok: false, reason: "cross_origin" };
    }
  } else if (secFetchSite === null) {
    // No Origin and no Fetch Metadata on a state-changing request — reject.
    return { ok: false, reason: "missing_origin_metadata" };
  }

  // Session-bound CSRF token hook (full wiring in Story 1.2).
  if (input.requireSessionToken) {
    if (
      !input.csrfToken ||
      !input.expectedCsrfToken ||
      input.csrfToken !== input.expectedCsrfToken
    ) {
      return { ok: false, reason: "csrf_token_mismatch" };
    }
  }

  return { ok: true, reason: "same_origin" };
}

/**
 * Stub for session-bound CSRF token issuance (Story 1.2).
 * Returns a placeholder shape so forms can wire the hook without inventing API later.
 */
export function createSessionCsrfTokenStub(): {
  headerName: string;
  formFieldName: string;
  note: string;
} {
  return {
    headerName: "X-CSRF-Token",
    formFieldName: "csrf_token",
    note: "Session-bound token generation ships with Story 1.2 auth.",
  };
}
