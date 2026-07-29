/**
 * CSRF delivery boundary (AD-22 / AR-18).
 *
 * State-changing requests must be same-origin via Origin and/or Sec-Fetch-Site.
 * Authenticated creator/admin mutations also require a token derived from the
 * validated Better Auth session.
 *
 * Better Auth mount path pass-through: when auth is mounted (Story 1.2),
 * BETTER_AUTH_MOUNT_PATH requests keep Better Auth's own CSRF/OAuth-state
 * protections. That path is the only scoped pass-through — never a general bypass.
 * Capability routes always go through this middleware.
 */

export const BETTER_AUTH_MOUNT_PATH = "/api/auth";
export const CSRF_HEADER_NAME = "X-CSRF-Token";
export const CSRF_FORM_FIELD_NAME = "csrf_token";

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

function timingSafeTokenEqual(actual: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);
  const length = Math.max(actualBytes.length, expectedBytes.length);
  let difference = actualBytes.length ^ expectedBytes.length;

  for (let index = 0; index < length; index += 1) {
    difference |=
      (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0);
  }

  return difference === 0;
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

  const KNOWN_SEC_FETCH_SITE = new Set([
    "same-origin",
    "same-site",
    "cross-site",
    "none",
  ]);
  const rawSecFetchSite = input.secFetchSite?.toLowerCase() ?? null;
  // Unrecognized Fetch Metadata values are treated as absent (fail closed),
  // never as a pass.
  const secFetchSite =
    rawSecFetchSite !== null && KNOWN_SEC_FETCH_SITE.has(rawSecFetchSite)
      ? rawSecFetchSite
      : null;
  // The literal string "null" (opaque origins: sandboxed iframes, redirects)
  // is not parseable as a URL — treat it as absent and rely on Fetch Metadata.
  const origin =
    input.origin && input.origin !== "null" ? input.origin : null;

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
      !timingSafeTokenEqual(input.csrfToken, input.expectedCsrfToken)
    ) {
      return { ok: false, reason: "csrf_token_mismatch" };
    }
  }

  return { ok: true, reason: "same_origin" };
}

export type SessionCsrfToken = {
  headerName: string;
  formFieldName: string;
  value: string;
};

function toBase64Url(value: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(value)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function createSessionCsrfToken(
  sessionId: string,
  secret: string,
): Promise<SessionCsrfToken> {
  if (!sessionId || !secret) {
    throw new Error("Session ID and auth secret are required for CSRF issuance");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`oddspark-csrf:v1:${sessionId}`),
  );

  return {
    headerName: CSRF_HEADER_NAME,
    formFieldName: CSRF_FORM_FIELD_NAME,
    value: toBase64Url(signature),
  };
}

export async function readRequestCsrfToken(
  request: Request,
): Promise<string | null> {
  const headerToken = request.headers.get(CSRF_HEADER_NAME);
  if (headerToken) return headerToken;

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    !contentType.startsWith("application/x-www-form-urlencoded") &&
    !contentType.startsWith("multipart/form-data")
  ) {
    return null;
  }

  try {
    const token = (await request.clone().formData()).get(CSRF_FORM_FIELD_NAME);
    return typeof token === "string" ? token : null;
  } catch {
    return null;
  }
}
