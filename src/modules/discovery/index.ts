// Discovery listing commands (Story 3.1): creator-controlled presentation
// state with an administrator-owned delisted guard (AD-5 / AD-19).
// Provider-free — D1 implements the ports; routes only map Results (AD-1).

import type {
  ApplicationError,
  Result,
} from "../../shared/application/index";
import type {
  DiscoveryState,
  PollId,
  UserId,
} from "../../shared/domain/index";

export const DISCOVERY_COPY = {
  unlistedDescription:
    "reachable only by link; absent from Discover and sitemaps",
  listedDescription:
    "appears on Discover and in sitemaps while the Poll is open",
  listingInvalid: "Pick a Discovery Setting.",
  delisted: "Delisted by the Administrator.",
  notFound: "This Poll doesn't exist.",
  editFailed: "That didn't save. Nothing changed — try again.",
} as const;

export const LISTING_CHOICES = [
  {
    value: "unlisted",
    label: "UNLISTED",
    description: DISCOVERY_COPY.unlistedDescription,
  },
  {
    value: "listed",
    label: "LISTED",
    description: DISCOVERY_COPY.listedDescription,
  },
] as const;

export type CreatorListingState = Exclude<DiscoveryState, "delisted">;

export type OwnedPollListingSnapshot = {
  discoveryState: DiscoveryState;
};

export type LoadOwnedPollListingPort = (
  pollId: PollId,
  ownerUserId: UserId,
) => Promise<OwnedPollListingSnapshot | null>;

export type UpdateListingPort = (input: {
  pollId: PollId;
  ownerUserId: UserId;
  state: CreatorListingState;
  updatedAtMs: number;
}) => Promise<"updated" | "unchanged" | "delisted" | "not_found">;

export type SetPollListingDeps = {
  loadOwnedPoll: LoadOwnedPollListingPort;
  updateListing: UpdateListingPort;
  nowMs: () => number;
};

export type SetPollListingOutcome = {
  kind: "updated" | "unchanged";
  state: CreatorListingState;
};

export function parseListingDraft(value: string): CreatorListingState | null {
  if (value === "unlisted" || value === "listed") {
    return value;
  }
  return null;
}

function notFoundError(): ApplicationError {
  return { code: "poll_not_found", message: DISCOVERY_COPY.notFound };
}

function delistedError(): ApplicationError {
  return { code: "poll_delisted", message: DISCOVERY_COPY.delisted };
}

function persistenceFailed(pollId: PollId, cause: unknown): ApplicationError {
  console.error("poll_edit_failed", {
    pollId,
    cause: cause instanceof Error ? cause.message : String(cause),
  });
  return { code: "poll_edit_failed", message: DISCOVERY_COPY.editFailed };
}

export async function setPollListing(
  deps: SetPollListingDeps,
  pollId: PollId,
  ownerUserId: UserId,
  requested: CreatorListingState,
): Promise<Result<SetPollListingOutcome>> {
  let existing: OwnedPollListingSnapshot | null;
  try {
    existing = await deps.loadOwnedPoll(pollId, ownerUserId);
  } catch (cause) {
    return { ok: false, error: persistenceFailed(pollId, cause) };
  }
  if (!existing) {
    return { ok: false, error: notFoundError() };
  }
  if (existing.discoveryState === "delisted") {
    return { ok: false, error: delistedError() };
  }
  if (existing.discoveryState === requested) {
    return {
      ok: true,
      value: { kind: "unchanged", state: requested },
    };
  }

  let result: "updated" | "unchanged" | "delisted" | "not_found";
  try {
    // Listing is presentation, not a voter representation contribution.
    // AD-24's enumerated versioned writes exclude discovery transitions, so
    // this port updates updated_at_ms without a representation version input.
    result = await deps.updateListing({
      pollId,
      ownerUserId,
      state: requested,
      updatedAtMs: deps.nowMs(),
    });
  } catch (cause) {
    return { ok: false, error: persistenceFailed(pollId, cause) };
  }

  if (result === "not_found") {
    return { ok: false, error: notFoundError() };
  }
  if (result === "delisted") {
    return { ok: false, error: delistedError() };
  }
  return {
    ok: true,
    value: { kind: result, state: requested },
  };
}
