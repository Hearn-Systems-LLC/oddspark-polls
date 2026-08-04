const RETURN_FALLBACK = "/creator";
const RETURN_POLICY_ORIGIN = "https://return-policy.invalid";
// Long enough for any real creator path; short enough that embedding the
// value in Better Auth's OAuth state cookie stays well under the 4KB
// browser cookie limit.
export const MAX_RETURN_ADDRESS_LENGTH = 512;
// Denial landing path for auth-flow failures. Shared by the Better Auth
// errorURL default and the auth handler's catch-all fallback so the two can
// never drift.
export const SIGN_IN_DENIED_PATH = "/sign-in?outcome=denied&return=%2Fcreator";
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function isSafeRelativePath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\") &&
    !ENCODED_PATH_SEPARATOR.test(value) &&
    !CONTROL_CHARACTER.test(value)
  );
}

export type CreatorSession = {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CreatorPrincipal = {
  userId: string;
  role: UserRole;
  session: CreatorSession;
};

export const USER_ROLES = ["creator", "administrator"] as const;

export type UserRole = (typeof USER_ROLES)[number];

/**
 * Better Auth data crosses a runtime boundary here. Unknown or absent values
 * deliberately collapse to the least-privileged role.
 */
export function parseUserRole(value: unknown): UserRole {
  if (value === "administrator") {
    return "administrator";
  }
  return "creator";
}

export function hasAdministratorCapability(
  principal: Pick<CreatorPrincipal, "role"> | null | undefined,
): boolean {
  return principal?.role === "administrator";
}

export function validateReturnAddress(
  value: string | null | undefined,
): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_RETURN_ADDRESS_LENGTH ||
    !isSafeRelativePath(value)
  ) {
    return RETURN_FALLBACK;
  }

  try {
    const parsed = new URL(value, RETURN_POLICY_ORIGIN);
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (
      parsed.origin !== RETURN_POLICY_ORIGIN ||
      // Enforce the cap on the normalized form too — percent-encoding
      // inflates multibyte input well past the raw length.
      normalized.length > MAX_RETURN_ADDRESS_LENGTH ||
      !isSafeRelativePath(normalized) ||
      !isCreatorSurfacePath(parsed.pathname)
    ) {
      return RETURN_FALLBACK;
    }
    return normalized;
  } catch {
    return RETURN_FALLBACK;
  }
}

export type SignInDestinations = {
  callbackURL: string;
  errorCallbackURL: string;
};

function withSignedInOutcome(returnAddress: string): string {
  const parsed = new URL(returnAddress, RETURN_POLICY_ORIGIN);
  parsed.searchParams.set("outcome", "signed-in");
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function createSignInDestinations(
  returnAddress: string | null | undefined,
): SignInDestinations {
  const safeReturnAddress = validateReturnAddress(returnAddress);
  const errorParams = new URLSearchParams({
    outcome: "denied",
    return: safeReturnAddress,
  });

  return {
    callbackURL: withSignedInOutcome(safeReturnAddress),
    errorCallbackURL: `/sign-in?${errorParams.toString()}`,
  };
}

export type SignInPageOutcome = {
  title: string;
  message: string;
};

export function resolveSignInPageOutcome(
  outcome: string | null,
  reason: string | null,
): SignInPageOutcome | null {
  if (outcome === "denied") {
    return {
      title: "That didn't sign you in — Oddspark Polls",
      message:
        "That didn't sign you in. Nothing was created, and nothing was lost — the create form is right where you left it.",
    };
  }

  if (reason === "expired") {
    return {
      title: "You've been signed out — Oddspark Polls",
      message:
        "You've been signed out. Sign back in to pick up where you left off.",
    };
  }

  return null;
}

export function isCreatorSurfacePath(pathname: string): boolean {
  return pathname === "/creator" || pathname.startsWith("/creator/");
}
