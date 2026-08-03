// Poll lifecycle commands (Story 1.12): close, edit definition, edit
// description, delete. Provider-free — D1 implements the ports (AD-1/AD-19).
// Routes parse FormData and map Results; ownership always comes from the
// authenticated principal + route PollId, never form fields (AD-4).

import {
  incrementRepresentationVersion,
  type ApplicationError,
  type RepresentationVersionIncrement,
  type Result,
} from "../../shared/application/index";
import {
  effectivePollStatus,
  type PollId,
  type PollOptionId,
  type PollType,
  type UserId,
} from "../../shared/domain/index";
import {
  normalizePollDescription,
  validatePollDefinition,
  type PollDefinitionDraft,
  type ValidatedPollDefinition,
} from "./definition";

export const LIFECYCLE_COPY = {
  definitionLocked:
    "Locked — the first Vote has been cast. The description is still yours to edit.",
  notFound: "This Poll doesn't exist.",
  closeFailed: "That didn't close. Nothing changed — try again.",
  editFailed: "That didn't save. Nothing changed — try again.",
  deleteFailed: "That didn't delete. Nothing changed — try again.",
  unsupportedPollType:
    "Only Multiple Choice is editable here. Poll Type can't be changed.",
  definitionConflict:
    "This Poll changed in another tab. Review the current definition and try again.",
  // Exact AC wording for delete confirmation is assembled by the route from
  // question + vote count; commands never render UI copy for the overlay.
  definitionIntentOnLocked:
    "This Poll's definition is locked. Only the description can change.",
  securityLocked:
    "Votes are in. Protections can tighten from here, not loosen.",
} as const;

export type PollLifecycleSnapshot = {
  pollId: PollId;
  ownerUserId: UserId;
  pollType: PollType;
  question: string;
  description: string | null;
  multiSelectEnabled: boolean;
  minSelections: number | null;
  maxSelections: number | null;
  sessionChecksEnabled: boolean;
  ipChecksEnabled: boolean;
  voterCodesEnabled: boolean;
  captchaEnabled: boolean;
  vpnBlockingEnabled: boolean;
  options: { id: PollOptionId; label: string; position: number }[];
  deadlineMs: number | null;
  closedAtMs: number | null;
  representationVersion: number;
  /** Distinct accepted Vote rows — presentation only; mutation re-checks D1. */
  voterCount: number;
};

export type ClosePollOutcome = {
  kind: "closed" | "already_closed";
  closedAtMs: number;
};

export type DescriptionUpdateOutcome = {
  kind: "updated" | "unchanged";
  description: string | null;
};

export type DefinitionUpdateOutcome =
  | {
      kind: "updated";
      definition: ValidatedPollDefinition;
      options: { id: PollOptionId; label: string; position: number }[];
    }
  | {
      kind: "unchanged";
    }
  | {
      kind: "description_only";
      description: string | null;
    };

export type DeletePollOutcome = {
  kind: "deleted";
};

// ---------------------------------------------------------------------------
// Persistence ports — implemented by the D1 adapter.
// ---------------------------------------------------------------------------

export type ClosePollPort = (input: {
  pollId: PollId;
  ownerUserId: UserId;
  version: RepresentationVersionIncrement;
}) => Promise<"closed" | "already_closed" | "not_found">;

export type UpdateDescriptionPort = (input: {
  pollId: PollId;
  ownerUserId: UserId;
  description: string | null;
  version: RepresentationVersionIncrement;
}) => Promise<"updated" | "unchanged" | "not_found">;

export type UpdateDefinitionPort = (input: {
  pollId: PollId;
  ownerUserId: UserId;
  definition: ValidatedPollDefinition;
  options: { id: PollOptionId; label: string; position: number }[];
  expectedRepresentationVersion: number;
  version: RepresentationVersionIncrement;
}) => Promise<
  "updated" | "locked" | "conflict" | "unsupported" | "not_found"
>;

export type DeletePollPort = (input: {
  pollId: PollId;
  ownerUserId: UserId;
}) => Promise<"deleted" | "not_found">;

export type LoadOwnedPollPort = (
  pollId: PollId,
  ownerUserId: UserId,
) => Promise<PollLifecycleSnapshot | null>;

// ---------------------------------------------------------------------------
// Shared error helpers
// ---------------------------------------------------------------------------

function notFoundError(): ApplicationError {
  return {
    code: "poll_not_found",
    message: LIFECYCLE_COPY.notFound,
  };
}

function lockedError(): ApplicationError {
  return {
    code: "poll_definition_locked",
    message: LIFECYCLE_COPY.definitionLocked,
  };
}

function unsupportedPollTypeError(): ApplicationError {
  return {
    code: "poll_type_unsupported",
    message: LIFECYCLE_COPY.unsupportedPollType,
  };
}

function definitionConflictError(): ApplicationError {
  return {
    code: "poll_definition_conflict",
    message: LIFECYCLE_COPY.definitionConflict,
  };
}

function persistenceFailed(
  code: "poll_close_failed" | "poll_edit_failed" | "poll_delete_failed",
  message: string,
  pollId: PollId,
  cause: unknown,
): ApplicationError {
  console.error(code, {
    pollId,
    cause: cause instanceof Error ? cause.message : String(cause),
  });
  return { code, message };
}

function effectiveMin(value: number | null): number {
  return value ?? 1;
}

function effectiveMax(value: number | null, optionCount: number): number {
  return value ?? optionCount;
}

function definitionsEqual(
  current: PollLifecycleSnapshot,
  next: ValidatedPollDefinition,
): {
  equal: boolean;
  descriptionOnly: boolean;
  definitionChanged: boolean;
} {
  const optionCount = next.options.length;
  const questionEqual = current.question === next.question;
  const optionsEqual =
    current.options.length === next.options.length &&
    current.options.every(
      (option, index) =>
        option.label === next.options[index]?.label &&
        option.position === next.options[index]?.position,
    );
  const multiEqual =
    current.multiSelectEnabled === next.multiSelect &&
    effectiveMin(current.minSelections) ===
      effectiveMin(next.minSelections) &&
    effectiveMax(current.maxSelections, current.options.length) ===
      effectiveMax(next.maxSelections, optionCount);
  const descriptionEqual = current.description === next.description;
  const definitionChanged = !(questionEqual && optionsEqual && multiEqual);
  const equal = !definitionChanged && descriptionEqual;
  return {
    equal,
    descriptionOnly: !definitionChanged && !descriptionEqual,
    definitionChanged,
  };
}

// ---------------------------------------------------------------------------
// closePoll
// ---------------------------------------------------------------------------

export type ClosePollDeps = {
  loadOwnedPoll: LoadOwnedPollPort;
  closePoll: ClosePollPort;
  nowMs: () => number;
};

export async function closePoll(
  deps: ClosePollDeps,
  pollId: PollId,
  ownerUserId: UserId,
): Promise<Result<ClosePollOutcome>> {
  const nowMs = deps.nowMs();
  let existing: PollLifecycleSnapshot | null;
  try {
    existing = await deps.loadOwnedPoll(pollId, ownerUserId);
  } catch (cause) {
    return {
      ok: false,
      error: persistenceFailed(
        "poll_close_failed",
        LIFECYCLE_COPY.closeFailed,
        pollId,
        cause,
      ),
    };
  }
  if (!existing) {
    return { ok: false, error: notFoundError() };
  }

  // Already effectively closed (manual or deadline) is an idempotent success:
  // never overwrite closed_at_ms or bump representation_version.
  if (effectivePollStatus(existing, nowMs) === "closed") {
    return {
      ok: true,
      value: {
        kind: "already_closed",
        closedAtMs: existing.closedAtMs ?? existing.deadlineMs ?? nowMs,
      },
    };
  }

  const version = incrementRepresentationVersion(pollId, nowMs);
  let result: "closed" | "already_closed" | "not_found";
  try {
    result = await deps.closePoll({
      pollId,
      ownerUserId,
      version,
    });
  } catch (cause) {
    return {
      ok: false,
      error: persistenceFailed(
        "poll_close_failed",
        LIFECYCLE_COPY.closeFailed,
        pollId,
        cause,
      ),
    };
  }

  if (result === "not_found") {
    return { ok: false, error: notFoundError() };
  }
  if (result === "already_closed") {
    // Race: became closed between load and UPDATE — re-read for the original
    // closure instant when possible.
    try {
      const again = await deps.loadOwnedPoll(pollId, ownerUserId);
      if (!again) {
        return { ok: false, error: notFoundError() };
      }
      return {
        ok: true,
        value: {
          kind: "already_closed",
          closedAtMs: again.closedAtMs ?? again.deadlineMs ?? nowMs,
        },
      };
    } catch (cause) {
      return {
        ok: false,
        error: persistenceFailed(
          "poll_close_failed",
          LIFECYCLE_COPY.closeFailed,
          pollId,
          cause,
        ),
      };
    }
  }

  return {
    ok: true,
    value: { kind: "closed", closedAtMs: nowMs },
  };
}

// ---------------------------------------------------------------------------
// updatePollDescription
// ---------------------------------------------------------------------------

export type UpdatePollDescriptionDeps = {
  loadOwnedPoll: LoadOwnedPollPort;
  updateDescription: UpdateDescriptionPort;
  nowMs: () => number;
};

export async function updatePollDescription(
  deps: UpdatePollDescriptionDeps,
  pollId: PollId,
  ownerUserId: UserId,
  rawDescription: string,
): Promise<Result<DescriptionUpdateOutcome>> {
  const normalized = normalizePollDescription(rawDescription);
  if (!normalized.ok) {
    return normalized;
  }

  let existing: PollLifecycleSnapshot | null;
  try {
    existing = await deps.loadOwnedPoll(pollId, ownerUserId);
  } catch (cause) {
    return {
      ok: false,
      error: persistenceFailed(
        "poll_edit_failed",
        LIFECYCLE_COPY.editFailed,
        pollId,
        cause,
      ),
    };
  }
  if (!existing) {
    return { ok: false, error: notFoundError() };
  }

  if (existing.description === normalized.value) {
    return {
      ok: true,
      value: { kind: "unchanged", description: existing.description },
    };
  }

  const nowMs = deps.nowMs();
  const version = incrementRepresentationVersion(pollId, nowMs);
  let result: "updated" | "unchanged" | "not_found";
  try {
    result = await deps.updateDescription({
      pollId,
      ownerUserId,
      description: normalized.value,
      version,
    });
  } catch (cause) {
    return {
      ok: false,
      error: persistenceFailed(
        "poll_edit_failed",
        LIFECYCLE_COPY.editFailed,
        pollId,
        cause,
      ),
    };
  }
  if (result === "not_found") {
    return { ok: false, error: notFoundError() };
  }
  if (result === "unchanged") {
    return {
      ok: true,
      value: { kind: "unchanged", description: normalized.value },
    };
  }
  return {
    ok: true,
    value: { kind: "updated", description: normalized.value },
  };
}

// ---------------------------------------------------------------------------
// updatePollDefinition
// ---------------------------------------------------------------------------

export type UpdatePollDefinitionDeps = {
  loadOwnedPoll: LoadOwnedPollPort;
  updateDefinition: UpdateDefinitionPort;
  updateDescription: UpdateDescriptionPort;
  generateId: () => string;
  nowMs: () => number;
};

export async function updatePollDefinition(
  deps: UpdatePollDefinitionDeps,
  pollId: PollId,
  ownerUserId: UserId,
  draft: PollDefinitionDraft,
): Promise<Result<DefinitionUpdateOutcome>> {
  const validated = validatePollDefinition(draft);
  if (!validated.ok) {
    return validated;
  }

  let existing: PollLifecycleSnapshot | null;
  try {
    existing = await deps.loadOwnedPoll(pollId, ownerUserId);
  } catch (cause) {
    return {
      ok: false,
      error: persistenceFailed(
        "poll_edit_failed",
        LIFECYCLE_COPY.editFailed,
        pollId,
        cause,
      ),
    };
  }
  if (!existing) {
    return { ok: false, error: notFoundError() };
  }
  if (existing.pollType !== "multiple_choice") {
    return { ok: false, error: unsupportedPollTypeError() };
  }

  const delta = definitionsEqual(existing, validated.value);
  if (delta.equal) {
    return { ok: true, value: { kind: "unchanged" } };
  }

  // Description-only delta: never churn option IDs; remains legal after a
  // first Vote (AD-17 / AD-24).
  if (delta.descriptionOnly) {
    const descriptionResult = await updatePollDescription(
      {
        loadOwnedPoll: deps.loadOwnedPoll,
        updateDescription: deps.updateDescription,
        nowMs: deps.nowMs,
      },
      pollId,
      ownerUserId,
      draft.description,
    );
    if (!descriptionResult.ok) {
      return descriptionResult;
    }
    return {
      ok: true,
      value: {
        kind: "description_only",
        description: descriptionResult.value.description,
      },
    };
  }

  // Presentation count is advisory only — D1 re-enforces no-Vote at mutation
  // time. Early return avoids minting option IDs when already locked.
  if (existing.voterCount > 0) {
    return { ok: false, error: lockedError() };
  }

  const nowMs = deps.nowMs();
  const options = validated.value.options.map((option) => ({
    id: deps.generateId() as PollOptionId,
    label: option.label,
    position: option.position,
  }));
  const version = incrementRepresentationVersion(pollId, nowMs);

  let result:
    | "updated"
    | "locked"
    | "conflict"
    | "unsupported"
    | "not_found";
  try {
    result = await deps.updateDefinition({
      pollId,
      ownerUserId,
      definition: validated.value,
      options,
      expectedRepresentationVersion: existing.representationVersion,
      version,
    });
  } catch (cause) {
    return {
      ok: false,
      error: persistenceFailed(
        "poll_edit_failed",
        LIFECYCLE_COPY.editFailed,
        pollId,
        cause,
      ),
    };
  }

  if (result === "not_found") {
    return { ok: false, error: notFoundError() };
  }
  if (result === "locked") {
    return { ok: false, error: lockedError() };
  }
  if (result === "unsupported") {
    return { ok: false, error: unsupportedPollTypeError() };
  }
  if (result === "conflict") {
    return { ok: false, error: definitionConflictError() };
  }

  return {
    ok: true,
    value: {
      kind: "updated",
      definition: validated.value,
      options,
    },
  };
}

// ---------------------------------------------------------------------------
// deletePoll
// ---------------------------------------------------------------------------

export type DeletePollDeps = {
  loadOwnedPoll: LoadOwnedPollPort;
  deletePoll: DeletePollPort;
};

export async function deletePoll(
  deps: DeletePollDeps,
  pollId: PollId,
  ownerUserId: UserId,
): Promise<Result<DeletePollOutcome>> {
  let existing: PollLifecycleSnapshot | null;
  try {
    existing = await deps.loadOwnedPoll(pollId, ownerUserId);
  } catch (cause) {
    return {
      ok: false,
      error: persistenceFailed(
        "poll_delete_failed",
        LIFECYCLE_COPY.deleteFailed,
        pollId,
        cause,
      ),
    };
  }
  if (!existing) {
    return { ok: false, error: notFoundError() };
  }

  let result: "deleted" | "not_found";
  try {
    result = await deps.deletePoll({ pollId, ownerUserId });
  } catch (cause) {
    return {
      ok: false,
      error: persistenceFailed(
        "poll_delete_failed",
        LIFECYCLE_COPY.deleteFailed,
        pollId,
        cause,
      ),
    };
  }
  if (result === "not_found") {
    return { ok: false, error: notFoundError() };
  }
  return { ok: true, value: { kind: "deleted" } };
}
