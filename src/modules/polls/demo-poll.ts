// Provider-free Demo Poll policy (AD-1 / AD-19). This module owns the one
// explicitly configured designation, its fixed voting contract, and reset
// eligibility. HTTP and D1 adapters implement the ports below.

import type { Result } from "../../shared/application/index";
import type {
  DiscoveryState,
  PollId,
  PollOptionId,
  PollType,
  ResultVisibility,
  UserId,
} from "../../shared/domain/index";
import { POLL_CAPS } from "./caps";
import { isReservedSlug } from "./reserved-slugs";

export const DEMO_POLL_TEMPLATE = Object.freeze({
  question: "Best day for a long weekend?",
  optionLabels: Object.freeze(["Friday", "Monday", "Either works"]),
  pollType: "multiple_choice" as const,
  multiSelectEnabled: false,
  minSelections: 1,
  maxSelections: 1,
  resultVisibility: "live" as const,
  deadlineMs: null,
  sessionChecksEnabled: true,
  ipChecksEnabled: false,
  voterCodesEnabled: false,
  captchaEnabled: true,
  vpnBlockingEnabled: false,
  initialDiscoveryState: "unlisted" as const,
});

export const DEMO_POLL_COPY = Object.freeze({
  unavailableTitle: "Demo unavailable — Oddspark Polls",
  unavailableHeading: "DEMO UNAVAILABLE",
  unavailableBody:
    "The live Demo is unavailable right now. The rest of Oddspark Polls is still here.",
  retry: "TRY AGAIN",
  resetTrigger: "RESET DEMO POLL",
  resetDisabled: "NO VOTES TO RESET",
  resetTitle: "RESET DEMO POLL?",
  resetBody:
    "This permanently clears every Vote from the landing-page Demo Poll. The public link stays the same.",
  resetCancel: "KEEP VOTES",
  resetConfirm: "RESET VOTES",
  resetPending: "RESETTING…",
  resetSuccessHeading: "DEMO POLL RESET",
  resetSuccessEmpty:
    "The landing-page Demo Poll is empty and ready for new Votes.",
  resetSuccessRaced: "The Demo Poll was reset. A new Vote has already arrived.",
  resetNotFound: "That Poll was not found, or you do not have access to it.",
  resetClosed: "A closed Demo Poll cannot be reset.",
  resetModerated: "A moderated Demo Poll cannot be reset.",
  resetDelisted: "A delisted Demo Poll cannot be reset.",
  resetIneligible: "This Poll no longer matches the Demo reset contract.",
  resetStale: "The Demo Poll changed before its Votes could be reset. Try again.",
  resetIntegrity: "The Demo Poll could not be reset safely. Nothing was changed.",
});

const unavailable = (): Result<never> => ({
  ok: false,
  error: {
    code: "demo_unavailable",
    message: DEMO_POLL_COPY.unavailableBody,
  },
});

export function validateDemoPollReference(
  value: string | undefined,
): Result<string> {
  if (
    value === undefined ||
    value.length === 0 ||
    value !== value.trim() ||
    value !== value.toLowerCase() ||
    value.length > POLL_CAPS.maxCustomLinkLength ||
    !/^[a-z0-9-]+$/.test(value) ||
    isReservedSlug(value)
  ) {
    return unavailable();
  }
  return { ok: true, value };
}

export function isDesignatedDemoPoll(
  canonicalReference: string,
  configuredReference: string | undefined,
): boolean {
  const configured = validateDemoPollReference(configuredReference);
  return configured.ok && canonicalReference === configured.value;
}

export type DemoPollSnapshot = {
  pollId: PollId;
  ownerUserId: UserId;
  canonicalReference: string;
  pollType: PollType;
  question: string;
  description: string | null;
  discoveryState: DiscoveryState;
  resultVisibility: ResultVisibility;
  multiSelectEnabled: boolean;
  minSelections: number | null;
  maxSelections: number | null;
  sessionChecksEnabled: boolean;
  ipChecksEnabled: boolean;
  voterCodesEnabled: boolean;
  captchaEnabled: boolean;
  vpnBlockingEnabled: boolean;
  options: Array<{
    id: PollOptionId;
    label: string;
    position: number;
  }>;
  deadlineMs: number | null;
  closedAtMs: number | null;
  representationVersion: number;
  voterCount: number;
  moderationActionCount: number;
};

export type DemoPollCompatibleSnapshot = Pick<
  DemoPollSnapshot,
  | "pollType"
  | "question"
  | "resultVisibility"
  | "multiSelectEnabled"
  | "minSelections"
  | "maxSelections"
  | "sessionChecksEnabled"
  | "ipChecksEnabled"
  | "voterCodesEnabled"
  | "captchaEnabled"
  | "vpnBlockingEnabled"
  | "options"
  | "deadlineMs"
>;

export function isDemoPollCompatible(snapshot: DemoPollCompatibleSnapshot): boolean {
  const optionLabels = [...snapshot.options]
    .sort((left, right) => left.position - right.position)
    .map((option) => option.label);

  return (
    snapshot.question === DEMO_POLL_TEMPLATE.question &&
    snapshot.pollType === DEMO_POLL_TEMPLATE.pollType &&
    optionLabels.length === DEMO_POLL_TEMPLATE.optionLabels.length &&
    optionLabels.every(
      (label, index) => label === DEMO_POLL_TEMPLATE.optionLabels[index],
    ) &&
    snapshot.multiSelectEnabled === DEMO_POLL_TEMPLATE.multiSelectEnabled &&
    (snapshot.minSelections ?? 1) === DEMO_POLL_TEMPLATE.minSelections &&
    (snapshot.maxSelections ?? 1) === DEMO_POLL_TEMPLATE.maxSelections &&
    snapshot.resultVisibility === DEMO_POLL_TEMPLATE.resultVisibility &&
    snapshot.deadlineMs === DEMO_POLL_TEMPLATE.deadlineMs &&
    snapshot.sessionChecksEnabled === DEMO_POLL_TEMPLATE.sessionChecksEnabled &&
    snapshot.ipChecksEnabled === DEMO_POLL_TEMPLATE.ipChecksEnabled &&
    snapshot.voterCodesEnabled === DEMO_POLL_TEMPLATE.voterCodesEnabled &&
    snapshot.captchaEnabled === DEMO_POLL_TEMPLATE.captchaEnabled &&
    snapshot.vpnBlockingEnabled === DEMO_POLL_TEMPLATE.vpnBlockingEnabled
  );
}

export function resolveDemoPoll(
  configuredReference: string | undefined,
  snapshot: DemoPollSnapshot | null,
): Result<DemoPollSnapshot> {
  const reference = validateDemoPollReference(configuredReference);
  if (
    !reference.ok ||
    snapshot === null ||
    snapshot.canonicalReference !== reference.value ||
    !isDemoPollCompatible(snapshot)
  ) {
    return unavailable();
  }
  return { ok: true, value: snapshot };
}

export type ReplaceDemoPollInput = {
  reference: string;
  expectedPollId: PollId;
  ownerUserId: UserId;
};

export type ReplaceDemoPollOutcome =
  | { kind: "replaced"; pollId: PollId; representationVersion: number }
  | { kind: "stale" }
  | { kind: "integrity_failure" };

export type ResetDemoPollOutcome =
  | { kind: "replaced"; pollId: PollId; representationVersion: number }
  | { kind: "unchanged"; pollId: PollId; representationVersion: number }
  | { kind: "stale"; currentPollId: PollId };

export type ResetDemoPollDependencies = {
  loadByReference: (reference: string) => Promise<DemoPollSnapshot | null>;
  replace: (input: ReplaceDemoPollInput) => Promise<ReplaceDemoPollOutcome>;
};

export type ResetDemoPollCommand = {
  configuredReference: string | undefined;
  requestedPollId: PollId;
  ownerUserId: UserId;
};

function resetFailure(code: string, message: string): Result<never> {
  return { ok: false, error: { code, message } };
}

export async function resetDemoPoll(
  dependencies: ResetDemoPollDependencies,
  command: ResetDemoPollCommand,
): Promise<Result<ResetDemoPollOutcome>> {
  const reference = validateDemoPollReference(command.configuredReference);
  if (!reference.ok) return reference;

  const snapshot = await dependencies.loadByReference(reference.value);
  if (snapshot === null || snapshot.ownerUserId !== command.ownerUserId) {
    return resetFailure("demo_reset_not_found", DEMO_POLL_COPY.resetNotFound);
  }
  if (snapshot.pollId !== command.requestedPollId) {
    return { ok: true, value: { kind: "stale", currentPollId: snapshot.pollId } };
  }
  if (!isDesignatedDemoPoll(snapshot.canonicalReference, reference.value)) {
    return resetFailure("demo_reset_ineligible", DEMO_POLL_COPY.resetIneligible);
  }
  if (!isDemoPollCompatible(snapshot)) {
    return resetFailure("demo_reset_ineligible", DEMO_POLL_COPY.resetIneligible);
  }
  if (snapshot.closedAtMs !== null) {
    return resetFailure("demo_reset_closed", DEMO_POLL_COPY.resetClosed);
  }
  if (snapshot.discoveryState === "delisted") {
    return resetFailure("demo_reset_delisted", DEMO_POLL_COPY.resetDelisted);
  }
  if (snapshot.moderationActionCount > 0) {
    return resetFailure("demo_reset_moderated", DEMO_POLL_COPY.resetModerated);
  }
  if (snapshot.voterCount === 0) {
    return {
      ok: true,
      value: {
        kind: "unchanged",
        pollId: snapshot.pollId,
        representationVersion: snapshot.representationVersion,
      },
    };
  }

  let outcome: ReplaceDemoPollOutcome;
  try {
    outcome = await dependencies.replace({
      reference: reference.value,
      expectedPollId: snapshot.pollId,
      ownerUserId: command.ownerUserId,
    });
  } catch {
    return resetFailure("demo_reset_integrity", DEMO_POLL_COPY.resetIntegrity);
  }

  if (outcome.kind === "replaced") return { ok: true, value: outcome };
  if (outcome.kind === "stale") {
    return resetFailure("demo_reset_stale", DEMO_POLL_COPY.resetStale);
  }
  return resetFailure("demo_reset_integrity", DEMO_POLL_COPY.resetIntegrity);
}
