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
  type PollSecurityToggles,
  type PollStatus,
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
// safe Poll configuration, not a result fact; `securityToggles` is the same
// kind of configuration (Story 2.4 — the trust badge explains visible
// numbers; it names mechanisms, never a digest, IP, or session identifier,
// AD-8). Discovery/listing state is
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
  securityToggles: PollSecurityToggles;
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

export type VersionedResultsTallyProjection = ResultsTallyProjection & {
  representationVersion: number;
};

// Live Results keeps the cheap validator read separate from the full Tally
// projection so authorization always happens first and a matching validator
// can avoid the heavier projection. The full projection carries its own
// version so the response body and ETag describe one D1 snapshot (AD-24).
export type LiveResultsPorts = Pick<ResultsPorts, "findAccessEnvelope"> & {
  readRepresentationVersion: (pollId: PollId) => Promise<number | null>;
  projectVersionedTally: (
    pollId: PollId,
  ) => Promise<VersionedResultsTallyProjection | null>;
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
  /** Unrounded share of Voters, supplied for exact PIE geometry. */
  pieShare: number;
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

// Public JSON contract consumed by the isolated Tally enhancer. Internal
// Poll identifiers and representation versions stay in the HTTP validator,
// never in the payload.
export type LiveResultsPayload = ResultsTallyView & {
  status: PollStatus;
};

export type ResultsView =
  | {
      kind: "visible";
      pollId: PollId;
      question: string;
      canonicalReference: string;
      status: PollStatus;
      /** Persisted toggle truth for the trust badge (Story 2.4) — safe Poll
       * configuration threaded from the envelope, never a result fact. */
      securityToggles: PollSecurityToggles;
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

// The live query owns a narrower outward union than the full page query.
// Hidden and absent outcomes structurally cannot carry a version, validator,
// or Tally; only an entitled outcome can expose those representation facts.
export type LiveResultsView =
  | {
      kind: "visible";
      pollId: PollId;
      canonicalReference: string;
      representationVersion: number;
      status: PollStatus;
      validator: string;
      tally: ResultsTallyView;
    }
  | {
      kind: "not_modified";
      pollId: PollId;
      canonicalReference: string;
      status: PollStatus;
      validator: string;
    }
  | {
      kind: "after_close_hidden";
      pollId: PollId;
      canonicalReference: string;
    }
  | {
      kind: "creator_only_hidden";
      pollId: PollId;
      canonicalReference: string;
    }
  | { kind: "not_found" };

// [ASSUMPTION: percentage denominator — ratified in this story's Dev Agent
// Record] Each option's percentage is the share of distinct Voters who
// selected it, rounded to the nearest whole number. Multi-select percentages
// may intentionally total above 100; the `N VOTERS · M SELECTIONS` line
// explains the shape. A zero-Voter denominator yields exactly 0 — never
// NaN/Infinity (resolves the deferred Story 1.1 input-safety item).
function shareOfVoters(optionCount: number, voterCount: number): number {
  if (voterCount <= 0) {
    return 0;
  }
  return optionCount / voterCount;
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
    options: ordered.map((option) => {
      const pieShare = shareOfVoters(option.count, projection.voterCount);
      return {
        ...option,
        percent: Math.round(pieShare * 100),
        pieShare,
        leading:
          positiveMax > 0 &&
          !tied &&
          leaders.length === 1 &&
          option.count === positiveMax,
      };
    }),
    voterCount: projection.voterCount,
    selectionCount: projection.selectionCount,
    tied,
    empty: positiveMax === 0,
  };
}

function resultsAreVisible(
  envelope: ResultsAccessEnvelope,
  viewer: ViewerContext,
  status: PollStatus,
): boolean {
  return (
    envelope.resultVisibility === "live" ||
    (envelope.resultVisibility === "after_close" && status === "closed") ||
    (envelope.resultVisibility === "creator_only" &&
      viewer.userId !== null &&
      viewer.userId === envelope.ownerUserId)
  );
}

export function composeResultsValidator(
  representationVersion: number,
  status: PollStatus,
): string {
  if (
    !Number.isSafeInteger(representationVersion) ||
    representationVersion < 1
  ) {
    throw new Error("Invalid representation version");
  }
  return `"${representationVersion}:${status}"`;
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

  const status = effectivePollStatus(envelope, nowMs);
  const visible = resultsAreVisible(envelope, viewer, status);

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
    status,
    securityToggles: envelope.securityToggles,
    tally: projectTallyView(envelope, projection),
  };
}

// Conditional live projection: resolve the safe envelope, authorize through
// the exact same decision as queryResults, then and only then read a version
// or Tally. The effective status is derived for every request, so crossing a
// Deadline changes the validator even when no mutation increments the Poll.
export async function queryLiveResults(
  ports: LiveResultsPorts,
  reference: string,
  viewer: ViewerContext,
  nowMs: number,
  currentValidator: string | null = null,
): Promise<LiveResultsView> {
  const envelope = await ports.findAccessEnvelope(reference);
  if (!envelope) {
    return { kind: "not_found" };
  }

  const status = effectivePollStatus(envelope, nowMs);
  if (!resultsAreVisible(envelope, viewer, status)) {
    return {
      kind:
        envelope.resultVisibility === "after_close"
          ? "after_close_hidden"
          : "creator_only_hidden",
      pollId: envelope.pollId,
      canonicalReference: envelope.canonicalReference,
    };
  }

  if (currentValidator !== null) {
    const representationVersion = await ports.readRepresentationVersion(
      envelope.pollId,
    );
    if (representationVersion === null) {
      throw new Error("Live Results version unavailable");
    }
    const validator = composeResultsValidator(representationVersion, status);
    if (currentValidator === validator) {
      return {
        kind: "not_modified",
        pollId: envelope.pollId,
        canonicalReference: envelope.canonicalReference,
        status,
        validator,
      };
    }
  }

  const projection = await ports.projectVersionedTally(envelope.pollId);
  if (projection === null) {
    throw new Error("Live Results projection unavailable");
  }
  const snapshotValidator = composeResultsValidator(
    projection.representationVersion,
    status,
  );
  return {
    kind: "visible",
    pollId: envelope.pollId,
    canonicalReference: envelope.canonicalReference,
    representationVersion: projection.representationVersion,
    status,
    validator: snapshotValidator,
    tally: projectTallyView(envelope, projection),
  };
}
