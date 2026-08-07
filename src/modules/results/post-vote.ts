import type { ResultsView } from "./index";

export type PostVoteResultsState = {
  kind: ResultsView["kind"] | "unavailable";
};

export type LoadBallotLabels = (
  voterToken: string,
) => Promise<readonly string[]>;

/**
 * Gates voter-linked claim reads behind the Results authorization decision.
 * The callback contains the digest and persistence work, so a hidden,
 * unavailable, or missing result cannot fetch private ballot facts and redact
 * them afterward. Claim lookup failure is additive: the authorized Tally
 * remains usable without a YOUR BALLOT line.
 */
export async function resolveAuthorizedBallotLabels(
  results: PostVoteResultsState,
  voterToken: string | null,
  loadLabels: LoadBallotLabels,
): Promise<string[]> {
  if (
    (results.kind !== "visible" && results.kind !== "ranked_visible") ||
    voterToken === null
  ) {
    return [];
  }

  try {
    return [...(await loadLabels(voterToken))];
  } catch {
    return [];
  }
}
