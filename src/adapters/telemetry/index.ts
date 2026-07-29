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
 * Exactly five fields. The type is intentionally narrow so forbidden
 * fields cannot be added without a deliberate type change.
 */
export type TelemetryRecord = {
  requestId: string;
  operation: string;
  result: TelemetryResultCode;
  durationMs: number;
  providerOutcome: ProviderOutcome;
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

export function isForbiddenTelemetryKey(
  key: string,
): key is ForbiddenTelemetryKey {
  return (FORBIDDEN_KEYS as readonly string[]).includes(key);
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
  };
  console.log(JSON.stringify(payload));
}

export function createRequestId(): string {
  return crypto.randomUUID();
}
