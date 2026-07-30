// Shared Kernel — domain (AD-23). Exclusive owner of branded entity IDs and
// the PollType, ResultVisibility, DiscoveryState, and effective PollStatus
// contracts. Provider-free: no Astro, no Cloudflare, no adapter imports.

declare const brand: unique symbol;
type Branded<T, B> = T & { readonly [brand]: B };

export type PollId = Branded<string, "PollId">;
export type PollOptionId = Branded<string, "PollOptionId">;
export type UserId = Branded<string, "UserId">;

export const POLL_TYPES = [
  "multiple_choice",
  "ranked_choice",
  "image",
  "meeting",
] as const;
export type PollType = (typeof POLL_TYPES)[number];

export const RESULT_VISIBILITIES = [
  "live",
  "after_close",
  "creator_only",
] as const;
export type ResultVisibility = (typeof RESULT_VISIBILITIES)[number];

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
