// Shared Kernel — application (AD-23). Owns the versioned Poll Type
// contribution interfaces and the HTTP error envelope. Contract changes
// require compile-time consumers and contract tests to change together.

import type { PollId, PollType } from "../domain/index";

// Application errors are stable codes with safe messages and optional field
// errors; HTTP adapters map them once (Consistency Conventions). Never
// provider or SQL detail.
export type FieldErrors = Record<string, string>;

export type ApplicationError = {
  code: string;
  message: string;
  fieldErrors?: FieldErrors;
  // Stable per-field machine codes mirroring fieldErrors keys — policy
  // branches key off these, never off the rendered copy (which is free to
  // change without touching behavior).
  reasonCodes?: Record<string, string>;
};

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ApplicationError };

// AD-24: every representation-changing command contributes this descriptor
// to its one atomic persistence batch. Adapters map the shared descriptor to
// provider SQL; commands never hand-roll the version update.
export type RepresentationVersionIncrement = {
  kind: "increment_representation_version";
  pollId: PollId;
  updatedAtMs: number;
};

export function incrementRepresentationVersion(
  pollId: PollId,
  updatedAtMs: number,
): RepresentationVersionIncrement {
  return {
    kind: "increment_representation_version",
    pollId,
    updatedAtMs,
  };
}

// ---------------------------------------------------------------------------
// Poll Type strategy contract (AD-3), contract version 1.
//
// Every Poll Type implements the same four ports. Story 1.3 exercises only
// `create`; `validateSubmission` and `persistFacts` are exercised from the
// vote transaction (Story 1.5), `projectResults` from the result surfaces
// (Story 1.8). The generics keep each type's facts relational and typed —
// never opaque JSON payloads.
//
// The frozen shape is design-checked against all four known Poll Types in
// docs/design/poll-type-contract-check.md (de-risk rule #1).
// ---------------------------------------------------------------------------

export const POLL_TYPE_CONTRACT_VERSION = 1;

export type PollTypeCreateContext = {
  nowMs: number;
};

// `create` normalizes type-specific creation input into the facts the
// CreatePoll command commits — in the SAME single D1 batch as the Poll row,
// its reference, and (for image polls) adopted media records.
export type PollTypeCreatePort<TCreateInput, TCreationFacts> = (
  input: TCreateInput,
  context: PollTypeCreateContext,
) => Result<TCreationFacts>;

export interface PollTypeStrategy<
  TCreateInput,
  TCreationFacts,
  TSubmission = unknown,
  TValidatedSubmission = unknown,
  TPersistedFacts = unknown,
  TResultProjection = unknown,
> {
  readonly type: PollType;
  readonly contractVersion: typeof POLL_TYPE_CONTRACT_VERSION;
  readonly create: PollTypeCreatePort<TCreateInput, TCreationFacts>;
  // Story 1.5: validates one Voter submission against the Poll's persisted
  // creation facts (selection shape, ballot ordering, availability grid).
  readonly validateSubmission?: (
    submission: TSubmission,
    facts: TCreationFacts,
  ) => Result<TValidatedSubmission>;
  // Story 1.5: contributes the type's normalized vote facts to the one
  // constrained CastVote D1 batch (AD-7).
  readonly persistFacts?: (validated: TValidatedSubmission) => TPersistedFacts;
  // Story 1.8: projects persisted facts into the type's result shape
  // (per-option tallies, IRV rounds, availability grid).
  readonly projectResults?: (facts: TPersistedFacts) => TResultProjection;
}
