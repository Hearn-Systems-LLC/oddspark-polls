import {
  COMMENT_CAPS,
  isCommentTimestamp,
} from "../modules/comments/index";
import type { CommentView } from "../modules/comments/index";
import type { LiveResultsPayload } from "../modules/results/index";
import type { PollStatus } from "../shared/domain/index";

export const RESULTS_POLL_CADENCE_MS = 3_000;
export const RESULTS_POLL_MAX_BACKOFF_MS = 30_000;

// Page-reload recovery (structural DOM/payload mismatch, lost entitlement,
// version regression) is capped per tab: beyond the cap the poller gives up
// and presents the last known Tally as stale instead of reloading forever.
export const RESULTS_LIVE_MAX_CONSECUTIVE_RELOADS = 2;

export type ResultsReloadRecovery = { token: string; count: number };

export function reserveResultsReload(
  recovery: ResultsReloadRecovery,
  token: string,
): { allowed: boolean; recovery: ResultsReloadRecovery } {
  const count = recovery.token === token ? recovery.count : 0;
  if (count >= RESULTS_LIVE_MAX_CONSECUTIVE_RELOADS) {
    return { allowed: false, recovery: { token, count } };
  }
  return {
    allowed: true,
    recovery: { token, count: count + 1 },
  };
}

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean => {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => key in value);
};

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPercent = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 100;

const isUnitShare = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;

export function isLiveResultsPayload(
  value: unknown,
): value is LiveResultsPayload {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "status",
      "multiSelectEnabled",
      "options",
      "voterCount",
      "selectionCount",
      "tied",
      "empty",
      "comments",
    ]) ||
    !Array.isArray(value.options) ||
    !Array.isArray(value.comments)
  ) {
    return false;
  }
  const comments = value.comments;
  if (
    (value.status !== "open" && value.status !== "closed") ||
    typeof value.multiSelectEnabled !== "boolean" ||
    !isNonNegativeSafeInteger(value.voterCount) ||
    !isNonNegativeSafeInteger(value.selectionCount) ||
    typeof value.tied !== "boolean" ||
    typeof value.empty !== "boolean"
  ) {
    return false;
  }
  const validOptions = value.options.every(
    (option) =>
      isRecord(option) &&
      hasExactKeys(option, [
        "id",
        "label",
        "position",
        "count",
        "percent",
        "pieShare",
        "leading",
      ]) &&
      typeof option.id === "string" &&
      typeof option.label === "string" &&
      isNonNegativeSafeInteger(option.position) &&
      isNonNegativeSafeInteger(option.count) &&
      isPercent(option.percent) &&
      isUnitShare(option.pieShare) &&
      typeof option.leading === "boolean",
  );
  const validComments = comments.every((comment, index) => {
    if (
      !isRecord(comment) ||
      !hasExactKeys(comment, ["body", "displayName", "createdAtMs"]) ||
      typeof comment.body !== "string" ||
      comment.body.length < 1 ||
      comment.body.length > COMMENT_CAPS.body ||
      comment.body !== comment.body.trim() ||
      /[\0\r]/u.test(comment.body) ||
      (comment.displayName !== null &&
        (typeof comment.displayName !== "string" ||
          comment.displayName.length < 1 ||
          comment.displayName.length > COMMENT_CAPS.displayName ||
          comment.displayName !== comment.displayName.trim() ||
          /[\0\r\n]/u.test(comment.displayName))) ||
      !isCommentTimestamp(comment.createdAtMs)
    ) {
      return false;
    }
    const previous = comments[index - 1];
    return (
      index === 0 ||
      (isRecord(previous) &&
        isNonNegativeSafeInteger(previous.createdAtMs) &&
        previous.createdAtMs >= comment.createdAtMs)
    );
  });
  return (
    validOptions &&
    validComments &&
    new Set(
      value.options.map((option) =>
        isRecord(option) && typeof option.id === "string" ? option.id : "",
      ),
    ).size === value.options.length
  );
}

export function sameCommentSnapshot(
  rendered: readonly CommentView[],
  incoming: readonly CommentView[],
): boolean {
  return (
    rendered.length === incoming.length &&
    rendered.every((comment, index) => {
      const next = incoming[index];
      return (
        next !== undefined &&
        comment.body === next.body &&
        comment.displayName === next.displayName &&
        comment.createdAtMs === next.createdAtMs
      );
    })
  );
}

export function shouldReloadOwnerCommentControls(input: {
  hasOwnerModeration: boolean;
  previousValidator: string | null;
  incomingValidator: string;
  commentsMatch: boolean;
}): boolean {
  if (!input.hasOwnerModeration || !input.commentsMatch) return false;
  const previous =
    input.previousValidator === null
      ? null
      : parseResultsValidator(input.previousValidator);
  const incoming = parseResultsValidator(input.incomingValidator);
  return (
    previous !== null &&
    incoming !== null &&
    incoming.representationVersion - previous.representationVersion > 1
  );
}

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
