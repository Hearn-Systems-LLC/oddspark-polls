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
  type PollType,
  type PollSecurityToggles,
  type PollStatus,
  type ResultVisibility,
  type UserId,
} from "../../shared/domain/index";
import type {
  CommentResultsProjection,
  CommentView,
  OwnerCommentView,
} from "../comments/index";
import type {
  RankedTallyView,
  VersionedRankedTallyProjection,
} from "./ranked-projection";

export type {
  RankedEliminationView,
  RankedOptionCountView,
  RankedRoundView,
  RankedTallyView,
  VersionedRankedTallyProjection,
} from "./ranked-projection";
export {
  projectRankedTallyView,
  tabulateAndProjectRanked,
} from "./ranked-projection";

/**
 * Drop the versioned adapter field so delivery never spreads
 * `representationVersion` into JSON bodies (validator/ETag only).
 */
function rankedTallyFromVersioned(
  projection: VersionedRankedTallyProjection,
): RankedTallyView {
  return {
    empty: projection.empty,
    voterCount: projection.voterCount,
    resolved: projection.resolved,
    winnerId: projection.winnerId,
    winnerLabel: projection.winnerLabel,
    tiedOptionIds: projection.tiedOptionIds,
    tiedOptionLabels: projection.tiedOptionLabels,
    finalCounts: projection.finalCounts,
    rounds: projection.rounds,
  };
}

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
  pollType: PollType;
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
    /** Adopted image plate (Story 6.2) — present only for image-poll
     * options. Rides the existing authorized projection (AD-21); never
     * serialized into the live payload (exact-key contract). */
    media?: { mediaId: string; altText: string; caption: string | null };
  }[];
  voterCount: number;
  selectionCount: number;
};

export type ResultsProjection = ResultsTallyProjection &
  CommentResultsProjection;

export type VersionedResultsProjection = ResultsProjection & {
  representationVersion: number;
};

export type ResultsPorts = {
  findAccessEnvelope: (
    reference: string,
  ) => Promise<ResultsAccessEnvelope | null>;
  projectResults: (
    pollId: PollId,
    includeOwnerModeration: boolean,
  ) => Promise<VersionedResultsProjection | null>;
  /** Ranked IRV projection — never invents a Multiple-Choice pseudo-Tally. */
  projectRankedResults: (
    pollId: PollId,
  ) => Promise<VersionedRankedTallyProjection | null>;
  /** Ranked-safe comments — joins through vote → vote_comment without touching vote_selection. */
  projectRankedComments: (
    pollId: PollId,
    includeOwnerModeration: boolean,
  ) => Promise<CommentResultsProjection | null>;
};

// Narrow compatibility projection retained for adapter-level Tally tests and
// callers that do not need Comments. Production Results queries use the
// coherent Results projection below.
export type VersionedResultsTallyProjection = ResultsTallyProjection & {
  representationVersion: number;
};

// Live Results keeps the cheap validator read separate from the full Tally
// projection so authorization always happens first and a matching validator
// can avoid the heavier projection. The full projection carries its own
// version so the response body and ETag describe one D1 snapshot (AD-24).
export type LiveResultsPorts = Pick<ResultsPorts, "findAccessEnvelope" | "projectRankedComments"> & {
  readRepresentationVersion: (pollId: PollId) => Promise<number | null>;
  projectVersionedResults: (
    pollId: PollId,
  ) => Promise<VersionedResultsProjection | null>;
  projectVersionedRankedResults: (
    pollId: PollId,
  ) => Promise<VersionedRankedTallyProjection | null>;
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
  rankedUnavailable:
    "Ranked-choice results aren't available yet. Ballots are recorded without showing a misleading Tally.",
  yourBallot: "YOUR BALLOT",
  manifestNotYet:
    "The Ballot Manifest publishes when the Poll closes — {deadline}.",
  manifestNotYetNoDeadline:
    "The Ballot Manifest publishes when the Poll closes.",
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
  /** Adopted image plate (Story 6.2) — server-rendered surfaces only.
   * The live route strips it before serialization so the exact-key
   * payload contract is untouched. */
  media?: { mediaId: string; altText: string; caption: string | null };
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
// never in the payload. Ranked payloads use an explicit discriminant so the
// MC exact-key validator and the ranked validator stay separate.
export type LiveMultipleChoicePayload = ResultsTallyView & {
  status: PollStatus;
  comments: CommentView[];
};

export type LiveRankedResultsPayload = RankedTallyView & {
  status: PollStatus;
  pollType: "ranked_choice";
  comments: CommentView[];
};

export type LiveResultsPayload =
  | LiveMultipleChoicePayload
  | LiveRankedResultsPayload;

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
      comments: CommentView[];
      ownerComments: OwnerCommentView[] | null;
      validator: string;
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
  | {
      kind: "ranked_visible";
      pollId: PollId;
      question: string;
      canonicalReference: string;
      status: PollStatus;
      securityToggles: PollSecurityToggles;
      ranked: RankedTallyView;
      comments: CommentView[];
      ownerComments: OwnerCommentView[] | null;
      validator: string;
    }
  | {
      kind: "ranked_unavailable";
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
      comments: CommentView[];
    }
  | {
      kind: "ranked_visible";
      pollId: PollId;
      canonicalReference: string;
      representationVersion: number;
      status: PollStatus;
      validator: string;
      ranked: RankedTallyView;
      comments: CommentView[];
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
  | {
      kind: "ranked_unavailable";
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

  if (envelope.pollType === "ranked_choice") {
    // Authorize first (above); only then read Ballot facts for IRV (AD-21).
    // Keep ranked_unavailable only if the ranked projection port is missing
    // (defensive residual path).
    if (typeof ports.projectRankedResults !== "function") {
      return {
        kind: "ranked_unavailable",
        pollId: envelope.pollId,
        question: envelope.question,
        canonicalReference: envelope.canonicalReference,
      };
    }
    const rankedProjection = await ports.projectRankedResults(envelope.pollId);
    if (rankedProjection === null) {
      throw new Error("Ranked Results projection unavailable");
    }
    const includeOwnerModeration =
      viewer.userId !== null && viewer.userId === envelope.ownerUserId;
    const commentProjection =
      typeof ports.projectRankedComments === "function"
        ? await ports.projectRankedComments(
            envelope.pollId,
            includeOwnerModeration,
          )
        : null;
    return {
      kind: "ranked_visible",
      pollId: envelope.pollId,
      question: envelope.question,
      canonicalReference: envelope.canonicalReference,
      status,
      securityToggles: envelope.securityToggles,
      ranked: rankedTallyFromVersioned(rankedProjection),
      comments: commentProjection?.comments ?? [],
      ownerComments: commentProjection?.ownerComments ?? null,
      validator: composeResultsValidator(
        rankedProjection.representationVersion,
        status,
      ),
    };
  }

  const includeOwnerModeration =
    viewer.userId !== null && viewer.userId === envelope.ownerUserId;
  const projection = await ports.projectResults(
    envelope.pollId,
    includeOwnerModeration,
  );
  if (projection === null) {
    throw new Error("Results projection unavailable");
  }
  return {
    kind: "visible",
    pollId: envelope.pollId,
    question: envelope.question,
    canonicalReference: envelope.canonicalReference,
    status,
    securityToggles: envelope.securityToggles,
    tally: projectTallyView(envelope, projection),
    comments: projection.comments,
    ownerComments: projection.ownerComments,
    validator: composeResultsValidator(projection.representationVersion, status),
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

  if (envelope.pollType === "ranked_choice") {
    if (typeof ports.projectVersionedRankedResults !== "function") {
      return {
        kind: "ranked_unavailable",
        pollId: envelope.pollId,
        canonicalReference: envelope.canonicalReference,
      };
    }
    const rankedProjection = await ports.projectVersionedRankedResults(
      envelope.pollId,
    );
    if (rankedProjection === null) {
      throw new Error("Live Ranked Results projection unavailable");
    }
    const snapshotValidator = composeResultsValidator(
      rankedProjection.representationVersion,
      status,
    );
    const commentProjection =
      typeof ports.projectRankedComments === "function"
        ? await ports.projectRankedComments(envelope.pollId, false)
        : null;
    return {
      kind: "ranked_visible",
      pollId: envelope.pollId,
      canonicalReference: envelope.canonicalReference,
      representationVersion: rankedProjection.representationVersion,
      status,
      validator: snapshotValidator,
      ranked: rankedTallyFromVersioned(rankedProjection),
      comments: commentProjection?.comments ?? [],
    };
  }

  const projection = await ports.projectVersionedResults(envelope.pollId);
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
    comments: projection.comments,
  };
}

// Ballot Manifest (Story 5.3, FR-10, AD-9): every Ballot's rankings in
// canonical order, stripped of all voter data and timestamps. Published only
// when the Poll is effectively closed AND the Tally is visible to this viewer.
export type BallotManifestRow = {
  readonly rankedOptionLabels: readonly string[];
  readonly count: number;
};

export type BallotManifestView =
  | {
      kind: "published";
      pollId: PollId;
      question: string;
      canonicalReference: string;
      ballots: readonly BallotManifestRow[];
    }
  | {
      kind: "not_yet";
      pollId: PollId;
      question: string;
      canonicalReference: string;
      deadlineMs: number | null;
    }
  | {
      kind: "hidden";
      pollId: PollId;
      canonicalReference: string;
    }
  | { kind: "not_found" };

export type BallotManifestPorts = {
  findAccessEnvelope: (
    reference: string,
  ) => Promise<ResultsAccessEnvelope | null>;
  projectBallotManifest: (
    pollId: PollId,
  ) => Promise<readonly BallotManifestRow[] | null>;
};

export async function queryBallotManifest(
  ports: BallotManifestPorts,
  reference: string,
  viewer: ViewerContext,
  nowMs: number,
): Promise<BallotManifestView> {
  const envelope = await ports.findAccessEnvelope(reference);
  if (!envelope) {
    return { kind: "not_found" };
  }

  const status = effectivePollStatus(envelope, nowMs);
  const visible = resultsAreVisible(envelope, viewer, status);

  if (!visible) {
    return {
      kind: "hidden",
      pollId: envelope.pollId,
      canonicalReference: envelope.canonicalReference,
    };
  }

  if (status !== "closed") {
    return {
      kind: "not_yet",
      pollId: envelope.pollId,
      question: envelope.question,
      canonicalReference: envelope.canonicalReference,
      deadlineMs: envelope.deadlineMs,
    };
  }

  const ballots = await ports.projectBallotManifest(envelope.pollId);
  if (ballots === null) {
    throw new Error("Ballot Manifest projection unavailable");
  }

  return {
    kind: "published",
    pollId: envelope.pollId,
    question: envelope.question,
    canonicalReference: envelope.canonicalReference,
    ballots,
  };
}
