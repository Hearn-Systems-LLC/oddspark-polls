import type { PollOptionId } from "../../shared/domain/index";

export type RankedPreferenceDraft = {
  optionId: PollOptionId;
  rank: number;
};

/**
 * Applies one rank-builder action without changing Creator-authored option
 * order. Unranked options take the next rank; ranked options are removed and
 * every later preference compacts by one.
 */
export function toggleRankedPreference(
  preferences: readonly RankedPreferenceDraft[],
  optionId: PollOptionId,
): RankedPreferenceDraft[] {
  const ordered = [...preferences].sort((left, right) => left.rank - right.rank);
  const existing = ordered.find((preference) => preference.optionId === optionId);
  if (existing === undefined) {
    return [...ordered, { optionId, rank: ordered.length + 1 }];
  }
  return ordered
    .filter((preference) => preference.optionId !== optionId)
    .map((preference, index) => ({ ...preference, rank: index + 1 }));
}

export function rankSummary(ranked: number, total: number): string {
  return `RANKED ${ranked} OF ${total} · UNRANKED OPTIONS COUNT AS NO PREFERENCE`;
}
