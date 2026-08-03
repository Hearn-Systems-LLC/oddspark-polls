// Poll security-toggle commands (Story 2.1): tighten-only after the first
// accepted Vote (AD-17). Provider-free — D1 implements the ports (AD-1/AD-19).
// Routes parse FormData and map Results; ownership always comes from the
// authenticated principal + route PollId, never form fields (AD-4).

import {
  incrementRepresentationVersion,
  type ApplicationError,
  type RepresentationVersionIncrement,
  type Result,
} from "../../shared/application/index";
import {
  SECURITY_TOGGLES,
  type PollId,
  type PollSecurityToggles,
  type SecurityToggle,
  type UserId,
} from "../../shared/domain/index";
import {
  LIFECYCLE_COPY,
  type LoadOwnedPollPort,
  type PollLifecycleSnapshot,
} from "./poll-lifecycle";

export const SECURITY_COPY = {
  locked: LIFECYCLE_COPY.securityLocked,
  editFailed: LIFECYCLE_COPY.editFailed,
  notFound: LIFECYCLE_COPY.notFound,
} as const;

// Verbatim names + voter-cost descriptions (D2). Keyed by toggle key so policy
// never branches on rendered copy.
export const SECURITY_TOGGLE_META: Record<
  SecurityToggle,
  { name: string; description: string }
> = {
  sessionChecks: {
    name: "Session Checks",
    description:
      "One Vote per browser. A Voter who switches browsers can Vote again.",
  },
  ipChecks: {
    name: "IP Checks",
    description:
      "One Vote per network. People sharing a connection can't each Vote.",
  },
  voterCodes: {
    name: "Voter Codes",
    description:
      "Voters need a code from you. Anyone without one is turned away.",
  },
  captcha: {
    name: "CAPTCHA",
    description: "A human check on submit. Scripts fail; people barely notice.",
  },
  vpnBlocking: {
    name: "VPN Blocking",
    description: "Votes from VPNs and datacenters are turned away.",
  },
};

export type SecurityTogglesUpdateOutcome =
  | { kind: "updated"; toggles: PollSecurityToggles }
  | { kind: "unchanged"; toggles: PollSecurityToggles };

export type UpdateSecurityTogglesPort = (input: {
  pollId: PollId;
  ownerUserId: UserId;
  toggles: PollSecurityToggles;
  version: RepresentationVersionIncrement;
}) => Promise<"updated" | "unchanged" | "locked" | "not_found">;

export type UpdatePollSecurityTogglesDeps = {
  loadOwnedPoll: LoadOwnedPollPort;
  updateSecurityToggles: UpdateSecurityTogglesPort;
  nowMs: () => number;
};

function notFoundError(): ApplicationError {
  return {
    code: "poll_not_found",
    message: SECURITY_COPY.notFound,
  };
}

function lockedError(): ApplicationError {
  return {
    code: "poll_security_locked",
    message: SECURITY_COPY.locked,
  };
}

function persistenceFailed(
  pollId: PollId,
  cause: unknown,
): ApplicationError {
  console.error("poll_edit_failed", {
    pollId,
    cause: cause instanceof Error ? cause.message : String(cause),
  });
  return { code: "poll_edit_failed", message: SECURITY_COPY.editFailed };
}

export function snapshotSecurityToggles(
  snapshot: PollLifecycleSnapshot,
): PollSecurityToggles {
  return {
    sessionChecks: snapshot.sessionChecksEnabled,
    ipChecks: snapshot.ipChecksEnabled,
    voterCodes: snapshot.voterCodesEnabled,
    captcha: snapshot.captchaEnabled,
    vpnBlocking: snapshot.vpnBlockingEnabled,
  };
}

/** Pure policy: any change when no votes; enable-only when votes exist. */
export function evaluateSecurityToggleChange(
  current: PollSecurityToggles,
  requested: PollSecurityToggles,
  voterCount: number,
):
  | { kind: "unchanged" }
  | { kind: "allowed"; next: PollSecurityToggles }
  | { kind: "locked" } {
  let changed = false;
  for (const key of SECURITY_TOGGLES) {
    if (current[key] !== requested[key]) {
      changed = true;
      if (voterCount > 0 && current[key] && !requested[key]) {
        return { kind: "locked" };
      }
    }
  }
  if (!changed) {
    return { kind: "unchanged" };
  }
  return { kind: "allowed", next: { ...requested } };
}

export function parseSecurityToggleDraft(
  draft: Record<SecurityToggle, string>,
): PollSecurityToggles {
  return {
    sessionChecks: draft.sessionChecks === "true",
    ipChecks: draft.ipChecks === "true",
    voterCodes: draft.voterCodes === "true",
    captcha: draft.captcha === "true",
    vpnBlocking: draft.vpnBlocking === "true",
  };
}

export async function updatePollSecurityToggles(
  deps: UpdatePollSecurityTogglesDeps,
  pollId: PollId,
  ownerUserId: UserId,
  requested: PollSecurityToggles,
): Promise<Result<SecurityTogglesUpdateOutcome>> {
  let existing: PollLifecycleSnapshot | null;
  try {
    existing = await deps.loadOwnedPoll(pollId, ownerUserId);
  } catch (cause) {
    return { ok: false, error: persistenceFailed(pollId, cause) };
  }
  if (!existing) {
    return { ok: false, error: notFoundError() };
  }

  const current = snapshotSecurityToggles(existing);
  const decision = evaluateSecurityToggleChange(
    current,
    requested,
    existing.voterCount,
  );
  if (decision.kind === "unchanged") {
    return {
      ok: true,
      value: { kind: "unchanged", toggles: current },
    };
  }
  if (decision.kind === "locked") {
    return { ok: false, error: lockedError() };
  }

  const nowMs = deps.nowMs();
  const version = incrementRepresentationVersion(pollId, nowMs);
  let result: "updated" | "unchanged" | "locked" | "not_found";
  try {
    result = await deps.updateSecurityToggles({
      pollId,
      ownerUserId,
      toggles: decision.next,
      version,
    });
  } catch (cause) {
    return { ok: false, error: persistenceFailed(pollId, cause) };
  }

  if (result === "not_found") {
    return { ok: false, error: notFoundError() };
  }
  if (result === "locked") {
    return { ok: false, error: lockedError() };
  }
  if (result === "unchanged") {
    return {
      ok: true,
      value: { kind: "unchanged", toggles: decision.next },
    };
  }
  return {
    ok: true,
    value: { kind: "updated", toggles: decision.next },
  };
}
