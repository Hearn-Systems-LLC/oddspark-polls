/**
 * Telemetry adapter (AD-15 / AR-12).
 *
 * Emits exactly one structured Workers Logs record per operation.
 * Forbidden forever: tokens, voter digests, Comments, ballot content, Voter Codes.
 */

export type ProviderOutcome =
  | "none"
  | "ok"
  | "error"
  | "timeout"
  | "skipped";

/** Stable result/error codes — expand in later stories; keep narrow here. */
export type TelemetryResultCode =
  | "ok"
  | "csrf_rejected"
  | "not_found"
  | "error";

/**
 * Exactly six fields. The type is intentionally narrow so forbidden
 * fields cannot be added without a deliberate type change.
 */
export type TelemetryRecord = {
  requestId: string;
  operation: string;
  result: TelemetryResultCode;
  durationMs: number;
  providerOutcome: ProviderOutcome;
  /** Internal ID only; public references and ballot data stay out of logs. */
  pollId: string | null;
};

const FORBIDDEN_KEYS = [
  "token",
  "tokens",
  "voterDigest",
  "voter_digest",
  "comment",
  "comments",
  "ballot",
  "ballotContent",
  "voterCode",
  "voter_code",
  "voterCodes",
] as const;

export type ForbiddenTelemetryKey = (typeof FORBIDDEN_KEYS)[number];

export function classifyAuthProviderOutcome(
  pathname: string,
  status: number,
  location: string | null,
): ProviderOutcome {
  const isAuthOperation =
    pathname === "/api/sign-in" ||
    pathname.startsWith("/api/auth/callback/");
  if (!isAuthOperation) return "none";
  if (status >= 400) return "error";

  if (location) {
    try {
      const destination = new URL(location, "https://telemetry.invalid");
      if (
        destination.pathname === "/sign-in" &&
        (destination.searchParams.get("outcome") === "denied" ||
          destination.searchParams.has("error"))
      ) {
        return "error";
      }
    } catch {
      return "error";
    }
  }

  return "ok";
}

export function isForbiddenTelemetryKey(
  key: string,
): key is ForbiddenTelemetryKey {
  return (FORBIDDEN_KEYS as readonly string[]).includes(key);
}

/**
 * Builds a stable operation name without putting a public Poll reference in
 * Workers Logs. `hasPollReferenceParam` comes from Astro's matched route
 * params; the reference value itself never crosses this boundary.
 */
export function telemetryOperationForRoute(
  method: string,
  pathname: string,
  hasPollReferenceParam: boolean,
): string {
  if (!hasPollReferenceParam) {
    return `${method} ${pathname}`;
  }

  const segments = pathname.split("/").filter(Boolean);
  const normalizedPathname =
    segments.length === 2 && segments[1] === "results"
      ? "/:reference/results"
      : "/:reference";
  return `${method} ${normalizedPathname}`;
}

/**
 * The single status → result mapping for the per-request record. A failed
 * session or Results lookup overrides an otherwise successful response. Vote
 * rejections (422) and rate limits (429) are errors ONLY when the vote route
 * flagged the request (`voteRejection`) — recording them as "ok" would make
 * the two rejection signals invisible, but an unflagged 422 (creator-surface
 * validation) is an ordinary outcome.
 */
export function telemetryResultForStatus(
  status: number,
  sessionLookupFailed = false,
  voteRejection = false,
  resultsLookupFailed = false,
): TelemetryResultCode {
  if (sessionLookupFailed || resultsLookupFailed || status >= 500) {
    return "error";
  }
  if (status === 403) {
    return "csrf_rejected";
  }
  if (status === 404) {
    return "not_found";
  }
  if (voteRejection && (status === 422 || status === 429)) {
    return "error";
  }
  return "ok";
}

/**
 * Typed emit — the only supported way to write operation telemetry.
 * Uses console.log of a JSON object so Workers Logs can structure it.
 */
export function emitTelemetry(record: TelemetryRecord): void {
  // Construct from known keys only — never spread untrusted objects.
  const payload: TelemetryRecord = {
    requestId: record.requestId,
    operation: record.operation,
    result: record.result,
    durationMs: record.durationMs,
    providerOutcome: record.providerOutcome,
    pollId: record.pollId,
  };
  console.log(JSON.stringify(payload));
}

export function createRequestId(): string {
  return crypto.randomUUID();
}
