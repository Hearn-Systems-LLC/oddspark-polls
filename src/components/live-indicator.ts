import type { PollStatus } from "../shared/domain/index";

export type LiveIndicatorState = {
  label: "LIVE" | "CLOSED";
  showDot: boolean;
};

export function liveIndicatorState(status: PollStatus): LiveIndicatorState {
  return status === "open"
    ? { label: "LIVE", showDot: true }
    : { label: "CLOSED", showDot: false };
}

export function formatVoteTotal(voterCount: number): string {
  return `${voterCount} ${voterCount === 1 ? "VOTE" : "VOTES"}`;
}
