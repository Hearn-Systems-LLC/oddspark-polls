import { POLL_CAPS } from "../modules/polls/caps";
import { isReservedSlug } from "../modules/polls/reserved-slugs";

export const MAX_MODERATION_TARGET_LENGTH = 512;
export const MAX_MODERATION_CSRF_TOKEN_LENGTH = 128;

const GENERATED_REFERENCE_LENGTH = 22;
const GENERATED_REFERENCE = /^[A-Za-z0-9_-]+$/;
const CUSTOM_REFERENCE = /^[a-z0-9-]+$/;
const ABSOLUTE_URL = /^[A-Za-z][A-Za-z\d+.-]*:\/\//;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const ENCODED_PATH_SEPARATOR = /%(?:2f|5c)/i;

export type ModerationIntent = "delist" | "clear_delisted";
export type ModerationOutcome = "delisted" | "cleared";

export type ModerationParseErrorCode =
  | "invalid_target"
  | "invalid_query"
  | "invalid_form";

export type ModerationParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ModerationParseErrorCode };

export type ParsedModerationTarget = {
  reference: string;
};

export type ParsedModerationQuery = {
  target: string | null;
  outcome: ModerationOutcome | null;
};

export type ParsedModerationForm = {
  intent: ModerationIntent;
  target: string;
  csrfToken: string;
};

const invalid = <T>(code: ModerationParseErrorCode): ModerationParseResult<T> => ({
  ok: false,
  code,
});

function isPollReference(reference: string): boolean {
  if (
    reference.length === 0 ||
    reference.length > POLL_CAPS.maxCustomLinkLength ||
    CONTROL_CHARACTER.test(reference) ||
    isReservedSlug(reference)
  ) {
    return false;
  }

  const generated =
    reference.length === GENERATED_REFERENCE_LENGTH &&
    GENERATED_REFERENCE.test(reference);
  const custom = CUSTOM_REFERENCE.test(reference);
  return generated || custom;
}

function sameOriginReference(
  target: string,
  expectedOrigin: string,
): string | null {
  if (
    CONTROL_CHARACTER.test(target) ||
    target.includes("\\") ||
    target.includes("?") ||
    target.includes("#") ||
    ENCODED_PATH_SEPARATOR.test(target)
  ) {
    return null;
  }

  // Inspect the unnormalized path as well as URL.pathname. Otherwise URL's
  // dot-segment normalization could turn a multi-segment paste into a valid
  // looking one-segment URL before this boundary sees it.
  const schemeEnd = target.indexOf("://");
  const authorityAndPath = target.slice(schemeEnd + 3);
  const pathStart = authorityAndPath.indexOf("/");
  if (pathStart < 0) {
    return null;
  }
  const rawPath = authorityAndPath.slice(pathStart);
  if (
    rawPath.length < 2 ||
    rawPath.slice(1).includes("/") ||
    rawPath.includes("\\")
  ) {
    return null;
  }

  try {
    const expected = new URL(expectedOrigin);
    const parsed = new URL(target);
    if (
      (expected.protocol !== "https:" && expected.protocol !== "http:") ||
      parsed.origin !== expected.origin ||
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username.length > 0 ||
      parsed.password.length > 0 ||
      parsed.search.length > 0 ||
      parsed.hash.length > 0 ||
      !/^\/[^/]+$/.test(parsed.pathname)
    ) {
      return null;
    }

    const reference = decodeURIComponent(parsed.pathname.slice(1));
    return isPollReference(reference) ? reference : null;
  } catch {
    return null;
  }
}

/**
 * Parses a lookup value without network access. The returned reference keeps
 * its exact case; alias-to-canonical resolution belongs to the D1 adapter.
 */
export function parseModerationTarget(
  target: unknown,
  expectedOrigin: string,
): ModerationParseResult<ParsedModerationTarget> {
  if (
    typeof target !== "string" ||
    target.length === 0 ||
    target.length > MAX_MODERATION_TARGET_LENGTH ||
    CONTROL_CHARACTER.test(target)
  ) {
    return invalid("invalid_target");
  }

  const reference = ABSOLUTE_URL.test(target)
    ? sameOriginReference(target, expectedOrigin)
    : isPollReference(target)
      ? target
      : null;

  return reference === null
    ? invalid("invalid_target")
    : { ok: true, value: { reference } };
}

export function parseModerationGetQuery(
  searchParams: URLSearchParams,
  expectedOrigin: string,
): ModerationParseResult<ParsedModerationQuery> {
  let rawTarget: string | null = null;
  let rawOutcome: string | null = null;
  let targetSeen = false;
  let outcomeSeen = false;

  for (const [key, value] of searchParams.entries()) {
    if (key === "target") {
      if (targetSeen) {
        return invalid("invalid_query");
      }
      targetSeen = true;
      rawTarget = value;
    } else if (key === "outcome") {
      if (outcomeSeen) {
        return invalid("invalid_query");
      }
      outcomeSeen = true;
      rawOutcome = value;
    } else {
      return invalid("invalid_query");
    }
  }

  if (!targetSeen && !outcomeSeen) {
    return { ok: true, value: { target: null, outcome: null } };
  }
  if (!targetSeen || rawTarget === null) {
    return invalid("invalid_query");
  }

  const target = parseModerationTarget(rawTarget, expectedOrigin);
  if (!target.ok) {
    return target;
  }

  let outcome: ModerationOutcome | null = null;
  if (outcomeSeen) {
    if (rawOutcome !== "delisted" && rawOutcome !== "cleared") {
      return invalid("invalid_query");
    }
    outcome = rawOutcome;
  }

  return {
    ok: true,
    value: { target: target.value.reference, outcome },
  };
}

export function parseModerationForm(
  formData: FormData,
  expectedOrigin: string,
): ModerationParseResult<ParsedModerationForm> {
  const allowed = new Set(["intent", "target", "csrf_token"]);
  const values = new Map<string, string>();

  for (const [key, value] of formData.entries()) {
    if (
      !allowed.has(key) ||
      values.has(key) ||
      typeof value !== "string"
    ) {
      return invalid("invalid_form");
    }
    values.set(key, value);
  }

  if (values.size !== allowed.size) {
    return invalid("invalid_form");
  }

  const rawIntent = values.get("intent");
  const rawTarget = values.get("target");
  const csrfToken = values.get("csrf_token");
  if (
    (rawIntent !== "delist" && rawIntent !== "clear_delisted") ||
    rawTarget === undefined ||
    csrfToken === undefined ||
    csrfToken.length === 0 ||
    csrfToken.length > MAX_MODERATION_CSRF_TOKEN_LENGTH ||
    CONTROL_CHARACTER.test(csrfToken)
  ) {
    return invalid("invalid_form");
  }

  const target = parseModerationTarget(rawTarget, expectedOrigin);
  if (!target.ok) {
    return target;
  }

  return {
    ok: true,
    value: {
      intent: rawIntent,
      target: target.value.reference,
      csrfToken,
    },
  };
}
