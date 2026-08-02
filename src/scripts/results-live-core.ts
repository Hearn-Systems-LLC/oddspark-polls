import type { PollStatus } from "../shared/domain/index";

export const RESULTS_POLL_CADENCE_MS = 3_000;
export const RESULTS_POLL_MAX_BACKOFF_MS = 30_000;

// Page-reload recovery (structural DOM/payload mismatch, lost entitlement,
// version regression) is capped per tab: beyond the cap the poller gives up
// and presents the last known Tally as stale instead of reloading forever.
export const RESULTS_LIVE_MAX_CONSECUTIVE_RELOADS = 2;

export type ResultsLiveConnection =
  | { kind: "live"; lastSuccessAtMs: number }
  | { kind: "stale"; lastSuccessAtMs: number }
  | { kind: "closed"; lastSuccessAtMs: number };

export type ResultsLiveState = {
  connection: ResultsLiveConnection;
  consecutiveFailures: number;
};

export type ParsedResultsValidator = {
  representationVersion: number;
  status: PollStatus;
};

export function createResultsLiveState(
  initialRenderAtMs: number,
): ResultsLiveState {
  return {
    connection: { kind: "live", lastSuccessAtMs: initialRenderAtMs },
    consecutiveFailures: 0,
  };
}

export function markResultsLiveFailure(
  state: ResultsLiveState,
): ResultsLiveState {
  if (state.connection.kind === "closed") {
    return state;
  }
  return {
    connection: {
      kind: "stale",
      lastSuccessAtMs: state.connection.lastSuccessAtMs,
    },
    consecutiveFailures: state.consecutiveFailures + 1,
  };
}

export function markResultsLiveSuccess(
  state: ResultsLiveState,
  nowMs: number,
  status: PollStatus,
): ResultsLiveState {
  if (state.connection.kind === "closed") {
    return state;
  }
  return {
    connection: {
      kind: status === "closed" ? "closed" : "live",
      lastSuccessAtMs: nowMs,
    },
    consecutiveFailures: 0,
  };
}

export function nextResultsPollDelayMs(state: ResultsLiveState): number {
  const exponent = Math.max(0, state.consecutiveFailures - 1);
  return Math.min(
    RESULTS_POLL_CADENCE_MS * 2 ** exponent,
    RESULTS_POLL_MAX_BACKOFF_MS,
  );
}

export function shouldPollResults(
  state: ResultsLiveState,
  visibilityState: DocumentVisibilityState,
  online: boolean,
): boolean {
  return (
    state.connection.kind !== "closed" &&
    visibilityState === "visible" &&
    online
  );
}

export function parseResultsValidator(
  value: string | null,
): ParsedResultsValidator | null {
  if (value === null) {
    return null;
  }
  const match = /^"([1-9]\d*):(open|closed)"$/.exec(value);
  if (!match) {
    return null;
  }
  const representationVersion = Number(match[1]);
  if (!Number.isSafeInteger(representationVersion)) {
    return null;
  }
  return {
    representationVersion,
    status: match[2] as PollStatus,
  };
}

// Responses normally arrive serially, but lifecycle events can supersede an
// in-flight request. A lower version can therefore never overwrite a newer
// snapshot, while effective closure at the same version remains observable.
export function shouldAdoptResultsValidator(
  current: string | null,
  incoming: string | null,
): boolean {
  const next = parseResultsValidator(incoming);
  if (!next) {
    return false;
  }
  const previous = parseResultsValidator(current);
  if (!previous) {
    return true;
  }
  if (next.representationVersion !== previous.representationVersion) {
    return next.representationVersion > previous.representationVersion;
  }
  return previous.status !== "closed" || next.status === "closed";
}
