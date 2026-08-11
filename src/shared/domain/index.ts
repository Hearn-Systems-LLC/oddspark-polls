// Shared Kernel — domain (AD-23). Exclusive owner of branded entity IDs and
// the PollType, ResultVisibility, DiscoveryState, and effective PollStatus
// contracts. Provider-free: no Astro, no Cloudflare, no adapter imports.

declare const brand: unique symbol;
type Branded<T, B> = T & { readonly [brand]: B };

export type PollId = Branded<string, "PollId">;
export type PollOptionId = Branded<string, "PollOptionId">;
export type CommentId = Branded<string, "CommentId">;
export type UserId = Branded<string, "UserId">;

export const POLL_TYPES = [
  "multiple_choice",
  "ranked_choice",
  "image",
  "meeting",
] as const;
export type PollType = (typeof POLL_TYPES)[number];

export const AVAILABILITY_STATES = ["yes", "if_need_be", "no"] as const;
export type AvailabilityState = (typeof AVAILABILITY_STATES)[number];
export function isAvailabilityState(state: string): state is AvailabilityState {
  return (AVAILABILITY_STATES as readonly string[]).includes(state);
}

export const RESULT_VISIBILITIES = [
  "live",
  "after_close",
  "creator_only",
] as const;
export type ResultVisibility = (typeof RESULT_VISIBILITIES)[number];

// FR-15 / UX-DR6: the five independent Security Toggles. Form field names and
// the trust-badge vocabulary share these keys (Story 2.1 / 2.4).
export const SECURITY_TOGGLES = [
  "sessionChecks",
  "ipChecks",
  "voterCodes",
  "captcha",
  "vpnBlocking",
] as const;
export type SecurityToggle = (typeof SECURITY_TOGGLES)[number];
export type PollSecurityToggles = Record<SecurityToggle, boolean>;

export function makeSecurityToggles(
  sessionChecks: boolean,
  ipChecks: boolean,
  voterCodes: boolean,
  captcha: boolean,
  vpnBlocking: boolean,
): PollSecurityToggles {
  return { sessionChecks, ipChecks, voterCodes, captcha, vpnBlocking };
}

export const DISCOVERY_STATES = ["unlisted", "listed", "delisted"] as const;
export type DiscoveryState = (typeof DISCOVERY_STATES)[number];

export type PollStatus = "open" | "closed";

export type PollLifecycle = {
  closedAtMs: number | null;
  deadlineMs: number | null;
};

// AD-11: effective state is closed whenever closed_at is set or the deadline
// is not later than the request timestamp. Status is always derived — it is
// never a stored column, so no scheduler is needed for correctness.
export function effectivePollStatus(
  lifecycle: PollLifecycle,
  nowMs: number,
): PollStatus {
  if (lifecycle.closedAtMs !== null) {
    return "closed";
  }
  if (lifecycle.deadlineMs !== null && lifecycle.deadlineMs <= nowMs) {
    return "closed";
  }
  return "open";
}
