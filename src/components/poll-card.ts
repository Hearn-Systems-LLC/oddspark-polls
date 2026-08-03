// Poll-card presentation model. UI labels and datetime formatting live beside
// the component so the Polls domain stays provider- and presentation-free
// (AD-1). Callers supply one request-scoped nowMs and the derived Poll status.

import { formatUtc } from "../lib/datetime";
import { countdownLabel } from "../modules/polls/deadline-display";
import type {
  DiscoveryState,
  PollStatus,
  PollType,
} from "../shared/domain/index";
import { formatVoteTotal } from "./live-indicator";

/** Exhaustive presentation label for every Poll Type. */
export const POLL_TYPE_LABELS = {
  multiple_choice: "MULTIPLE CHOICE",
  ranked_choice: "RANKED CHOICE",
  image: "IMAGE",
  meeting: "MEETING",
} as const satisfies { readonly [K in PollType]: string };

export type PollCardClosingView =
  | { kind: "none" }
  | { kind: "countdown"; text: string }
  | { kind: "absolute"; deadlineMs: number; utcFloor: string };

export type PollCardViewModelInput = {
  title: string;
  pollType: PollType;
  voterCount: number;
  status: PollStatus;
  deadlineMs: number | null;
  nowMs: number;
  href: string;
  current?: boolean;
  listing?: DiscoveryState;
};

export type PollCardViewModel = {
  title: string;
  metadata: {
    typeLabel: (typeof POLL_TYPE_LABELS)[PollType];
    voteTotal: string;
    closing: PollCardClosingView;
  };
  status: PollStatus;
  href: string;
  current: boolean;
  listing?: DiscoveryState;
};

function closingView(
  status: PollStatus,
  deadlineMs: number | null,
  nowMs: number,
): PollCardClosingView {
  if (status !== "open" || deadlineMs === null) {
    return { kind: "none" };
  }

  const countdown = countdownLabel(deadlineMs, nowMs);
  if (countdown !== null) {
    return { kind: "countdown", text: countdown };
  }

  return {
    kind: "absolute",
    deadlineMs,
    utcFloor: formatUtc(deadlineMs),
  };
}

/** Build the single structured result consumed by one Poll-card row. */
export function buildPollCardViewModel(
  input: PollCardViewModelInput,
): PollCardViewModel {
  return {
    title: input.title,
    metadata: {
      typeLabel: POLL_TYPE_LABELS[input.pollType],
      voteTotal: formatVoteTotal(input.voterCount),
      closing: closingView(input.status, input.deadlineMs, input.nowMs),
    },
    status: input.status,
    href: input.href,
    current: input.current ?? false,
    listing: input.listing,
  };
}
