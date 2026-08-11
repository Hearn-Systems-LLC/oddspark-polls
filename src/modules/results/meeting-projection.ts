// Serializable Meeting Tally projection (Story 7.4). The D1 adapter supplies
// identifier-free, position-aligned facts; this provider-free module marks the
// best slot(s) without selecting or committing a meeting time (FR-14/AD-9).

import type {
  AvailabilityState,
  PollStatus,
} from "../../shared/domain/index";

export type MeetingSlotProjectionInput = {
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  readonly timeZone: string;
  readonly position: number;
  readonly yesCount: number;
  readonly ifNeedBeCount: number;
  readonly noCount: number;
};

export type MeetingVoterProjectionInput = {
  readonly displayName: string;
  /** Position-aligned with `slots`; null is an unanswered/missing row. */
  readonly availability: readonly (AvailabilityState | null)[];
};

/** Identifier-free facts returned by the one-snapshot D1 projection. */
export type MeetingProjectionInput = {
  readonly representationVersion: number;
  readonly effectiveStatus: PollStatus;
  readonly slots: readonly MeetingSlotProjectionInput[];
  readonly voters: readonly MeetingVoterProjectionInput[];
};

export type MeetingSlotTallyView = MeetingSlotProjectionInput & {
  readonly isBest: boolean;
};

export type MeetingVoterTallyView = MeetingVoterProjectionInput;

/** Outward Meeting tally — serializable and free of Vote/Slot identifiers. */
export type MeetingTallyView = {
  readonly empty: boolean;
  readonly voterCount: number;
  /** Display order is always the Creator-authored Slot position order. */
  readonly slots: readonly MeetingSlotTallyView[];
  readonly voters: readonly MeetingVoterTallyView[];
};

export type VersionedMeetingTallyProjection = MeetingTallyView & {
  readonly representationVersion: number;
  readonly effectiveStatus: PollStatus;
};

function compareRank(
  left: MeetingSlotProjectionInput,
  right: MeetingSlotProjectionInput,
): number {
  return (
    right.yesCount - left.yesCount ||
    right.ifNeedBeCount - left.ifNeedBeCount ||
    left.position - right.position
  );
}

/**
 * Rank by yes, then if-need-be, while retaining authored display order.
 * Position makes ranking deterministic but does not break best-key ties: all
 * Slots sharing the top (yes, if-need-be) pair are marked together. A
 * zero-yes field has no best Slot because gold must never imply a winner.
 */
export function projectMeetingTally(
  input: MeetingProjectionInput,
): VersionedMeetingTallyProjection {
  const displaySlots = input.slots
    .map((slot) => ({ ...slot }))
    .sort((left, right) => left.position - right.position);
  const rankedSlots = [...displaySlots].sort(compareRank);
  const leader = rankedSlots[0];
  const hasBest = leader !== undefined && leader.yesCount > 0;

  const slots: MeetingSlotTallyView[] = displaySlots.map((slot) => ({
    ...slot,
    isBest:
      hasBest &&
      slot.yesCount === leader.yesCount &&
      slot.ifNeedBeCount === leader.ifNeedBeCount,
  }));
  const voters: MeetingVoterTallyView[] = input.voters.map((voter) => ({
    displayName: voter.displayName,
    availability: displaySlots.map((_, index) => voter.availability[index] ?? null),
  }));

  return {
    representationVersion: input.representationVersion,
    effectiveStatus: input.effectiveStatus,
    empty: voters.length === 0,
    voterCount: voters.length,
    slots,
    voters,
  };
}
