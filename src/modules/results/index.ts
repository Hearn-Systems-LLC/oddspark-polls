// Results application module (AD-19): owns the visibility policy and the
// outward Tally projection for every Results surface. Provider-free — no
// Astro, no D1, no cookies, no route types (AD-1). Authorization precedes
// private-fact retrieval (AD-21/AR-17): the access envelope is resolved and
// authorized first, and only a `visible` decision may call the tally port.
// Results owns no facts and never writes.

import {
  effectivePollStatus,
  type PollId,
  type PollOptionId,
  type ResultVisibility,
  type UserId,
} from "../../shared/domain/index";

// The only identity fact Results may consult: the authenticated internal
// Oddspark user ID, or anonymous. Never a Google/GitHub identifier (AD-4).
export type ViewerContext = {
  userId: UserId | null;
};

// The safe access read: only what entitlement and the permitted hidden shape
// need. Deliberately NO options, option counts, Vote counts, percentages,
// representationVersion, or any other result-shape signal — hidden responses
// must not leak the result's shape (FR-20, UX-DR19). `multiSelectEnabled` is
// safe Poll configuration, not a result fact. Discovery/listing state is
// absent by design: a reached-by-link Poll gets the same Results decision
// listed, unlisted, or delisted (AD-5).
export type ResultsAccessEnvelope = {
  pollId: PollId;
  question: string;
  resultVisibility: ResultVisibility;
  ownerUserId: UserId;
  deadlineMs: number | null;
  closedAtMs: number | null;
  multiSelectEnabled: boolean;
  canonicalReference: string;
};

// The private tally projection port's raw shape: per-option accepted
// selection counts in creator-authored position order, plus the aggregate
// Voter and selection totals computed in the same SQL statement (AD-9).
export type ResultsTallyProjection = {
  options: {
    id: PollOptionId;
    label: string;
    position: number;
    count: number;
  }[];
  voterCount: number;
  selectionCount: number;
};

export type ResultsPorts = {
  findAccessEnvelope: (
    reference: string,
  ) => Promise<ResultsAccessEnvelope | null>;
  projectTally: (pollId: PollId) => Promise<ResultsTallyProjection>;
};

// Results-owned copy for the hidden shapes and Tally annotations. The voting
// module's VOTE_COPY covers the post-vote confirmation; these strings cover
// the direct Results surface.
export const RESULTS_COPY = {
  afterCloseHidden: "Results open when the Poll closes — {deadline}.",
  afterCloseHiddenNoDeadline: "Results open when the Poll closes.",
  creatorOnlyHidden: "These results go to the Creator only.",
  empty: "No Votes yet. Yours would be the first, which is a kind of power.",
  tied: "TIED",
  unavailable: "Results are unavailable right now.",
  yourBallot: "YOUR BALLOT",
} as const;

export type ResultsTallyOptionView = {
  id: PollOptionId;
  label: string;
  position: number;
  count: number;
  percent: number;
  leading: boolean;
};

// The outward projection — the only result shape delivery may render. It
// carries no claim digest, submission ID, browser token, or voter-linked
// ballot fact, and `multiSelectEnabled` travels explicitly (never inferred
// from current counts) so the summary renders even at zero Votes or when
// every Voter selected exactly one option.
export type ResultsTallyView = {
  multiSelectEnabled: boolean;
  options: ResultsTallyOptionView[];
  voterCount: number;
  selectionCount: number;
  tied: boolean;
  empty: boolean;
};

export type ResultsView =
  | {
      kind: "visible";
      pollId: PollId;
      question: string;
      canonicalReference: string;
      tally: ResultsTallyView;
    }
  | {
      kind: "after_close_hidden";
      pollId: PollId;
      question: string;
      canonicalReference: string;
      deadlineMs: number | null;
    }
  | {
      kind: "creator_only_hidden";
      pollId: PollId;
      question: string;
      canonicalReference: string;
    }
  | { kind: "not_found" };

// [ASSUMPTION: percentage denominator — ratified in this story's Dev Agent
// Record] Each option's percentage is the share of distinct Voters who
// selected it, rounded to the nearest whole number. Multi-select percentages
// may intentionally total above 100; the `N VOTERS · M SELECTIONS` line
// explains the shape. A zero-Voter denominator yields exactly 0 — never
// NaN/Infinity (resolves the deferred Story 1.1 input-safety item).
function percentOfVoters(optionCount: number, voterCount: number): number {
  if (voterCount <= 0) {
    return 0;
  }
  return Math.round((optionCount / voterCount) * 100);
}

// Leader/tie derives from positive counts only: one unique positive maximum
// leads; two or more sharing it are TIED (no leader, no gold); all-zero is
// the empty state, not a tie. Order is never changed by count.
function projectTallyView(
  envelope: ResultsAccessEnvelope,
  projection: ResultsTallyProjection,
): ResultsTallyView {
  const ordered = [...projection.options].sort(
    (left, right) => left.position - right.position,
  );
  const positiveMax = Math.max(0, ...ordered.map(({ count }) => count));
  const leaders = ordered.filter(({ count }) => count === positiveMax);
  const tied = positiveMax > 0 && leaders.length > 1;
  return {
    multiSelectEnabled: envelope.multiSelectEnabled,
    options: ordered.map((option) => ({
      ...option,
      percent: percentOfVoters(option.count, projection.voterCount),
      leading:
        positiveMax > 0 &&
        !tied &&
        leaders.length === 1 &&
        option.count === positiveMax,
    })),
    voterCount: projection.voterCount,
    selectionCount: projection.selectionCount,
    tied,
    empty: positiveMax === 0,
  };
}

// The one Results application query. Observable two-step order: resolve the
// access envelope → authorize → and only for `visible` call the private
// tally projection. Never fetch-then-redact (AD-21/AR-17). Effective closure
// is computed from the shared rule on every query, so After Close opens by
// deadline comparison with no scheduler or persistence write (AD-11).
export async function queryResults(
  ports: ResultsPorts,
  reference: string,
  viewer: ViewerContext,
  nowMs: number,
): Promise<ResultsView> {
  const envelope = await ports.findAccessEnvelope(reference);
  if (!envelope) {
    return { kind: "not_found" };
  }

  const visible =
    envelope.resultVisibility === "live" ||
    (envelope.resultVisibility === "after_close" &&
      effectivePollStatus(envelope, nowMs) === "closed") ||
    (envelope.resultVisibility === "creator_only" &&
      viewer.userId !== null &&
      viewer.userId === envelope.ownerUserId);

  if (!visible) {
    return envelope.resultVisibility === "after_close"
      ? {
          kind: "after_close_hidden",
          pollId: envelope.pollId,
          question: envelope.question,
          canonicalReference: envelope.canonicalReference,
          deadlineMs: envelope.deadlineMs,
        }
      : {
          kind: "creator_only_hidden",
          pollId: envelope.pollId,
          question: envelope.question,
          canonicalReference: envelope.canonicalReference,
        };
  }

  const projection = await ports.projectTally(envelope.pollId);
  return {
    kind: "visible",
    pollId: envelope.pollId,
    question: envelope.question,
    canonicalReference: envelope.canonicalReference,
    tally: projectTallyView(envelope, projection),
  };
}
