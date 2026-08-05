import { describe, expect, it, vi } from "vitest";
import {
  SECURITY_COPY,
  evaluateSecurityToggleChange,
  parseSecurityToggleDraft,
  updatePollSecurityToggles,
  type PollLifecycleSnapshot,
} from "../../src/modules/polls/index";
import type {
  PollId,
  PollOptionId,
  PollSecurityToggles,
  UserId,
} from "../../src/shared/domain/index";
import { SECURITY_TOGGLES } from "../../src/shared/domain/index";

const NOW = 1_800_000_000_000;
const POLL_ID = "poll-1" as PollId;
const OWNER = "owner-1" as UserId;

const DEFAULT_TOGGLES: PollSecurityToggles = {
  sessionChecks: true,
  ipChecks: false,
  voterCodes: false,
  captcha: false,
  vpnBlocking: false,
};

function snapshot(
  overrides: Partial<PollLifecycleSnapshot> = {},
): PollLifecycleSnapshot {
  return {
    pollId: POLL_ID,
    ownerUserId: OWNER,
    pollType: "multiple_choice",
    question: "Where should we eat?",
    description: null,
    discoveryState: "unlisted",
    multiSelectEnabled: false,
    minSelections: null,
    maxSelections: null,
    sessionChecksEnabled: true,
    ipChecksEnabled: false,
    voterCodesEnabled: false,
    captchaEnabled: false,
    commentsEnabled: false,
    vpnBlockingEnabled: false,
    options: [
      {
        id: "opt-a" as PollOptionId,
        label: "Pizza",
        position: 0,
      },
    ],
    deadlineMs: null,
    closedAtMs: null,
    representationVersion: 1,
    voterCount: 0,
    ...overrides,
  };
}

describe("evaluateSecurityToggleChange", () => {
  it("allows any combination when no votes exist", () => {
    const requested: PollSecurityToggles = {
      sessionChecks: false,
      ipChecks: true,
      voterCodes: true,
      captcha: true,
      vpnBlocking: true,
    };
    expect(
      evaluateSecurityToggleChange(DEFAULT_TOGGLES, requested, 0),
    ).toEqual({ kind: "allowed", next: requested });
  });

  it("returns unchanged when requested equals current", () => {
    expect(
      evaluateSecurityToggleChange(DEFAULT_TOGGLES, DEFAULT_TOGGLES, 0),
    ).toEqual({ kind: "unchanged" });
    expect(
      evaluateSecurityToggleChange(DEFAULT_TOGGLES, DEFAULT_TOGGLES, 3),
    ).toEqual({ kind: "unchanged" });
  });

  it("allows enabling an off Toggle after votes exist", () => {
    const requested = { ...DEFAULT_TOGGLES, captcha: true };
    expect(
      evaluateSecurityToggleChange(DEFAULT_TOGGLES, requested, 1),
    ).toEqual({ kind: "allowed", next: requested });
  });

  it.each(SECURITY_TOGGLES)(
    "rejects disabling the on %s Toggle after votes exist",
    (toggle) => {
      const current: PollSecurityToggles = {
        ...DEFAULT_TOGGLES,
        [toggle]: true,
      };
      const requested: PollSecurityToggles = {
        ...current,
        [toggle]: false,
      };

      expect(evaluateSecurityToggleChange(current, requested, 1)).toEqual({
        kind: "locked",
      });
    },
  );

  it("rejects a mixed request that disables any on Toggle post-vote", () => {
    expect(
      evaluateSecurityToggleChange(
        { ...DEFAULT_TOGGLES, captcha: true },
        { ...DEFAULT_TOGGLES, sessionChecks: false, captcha: true, ipChecks: true },
        2,
      ),
    ).toEqual({ kind: "locked" });
  });
});

describe("parseSecurityToggleDraft", () => {
  it("maps checkbox true-only semantics with absence as off", () => {
    expect(
      parseSecurityToggleDraft({
        sessionChecks: "true",
        ipChecks: "",
        voterCodes: "false",
        captcha: "yes",
        vpnBlocking: "true",
      }),
    ).toEqual({
      sessionChecks: true,
      ipChecks: false,
      voterCodes: false,
      captcha: false,
      vpnBlocking: true,
    });
  });
});

describe("updatePollSecurityToggles", () => {
  it("is a no-op with no version bump when toggles match", async () => {
    const updateSecurityToggles = vi.fn();
    const result = await updatePollSecurityToggles(
      {
        loadOwnedPoll: async () => snapshot(),
        updateSecurityToggles,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      DEFAULT_TOGGLES,
    );
    expect(result).toEqual({
      ok: true,
      value: { kind: "unchanged", toggles: DEFAULT_TOGGLES },
    });
    expect(updateSecurityToggles).not.toHaveBeenCalled();
  });

  it("persists an allowed change with a representation version increment", async () => {
    const next = { ...DEFAULT_TOGGLES, ipChecks: true };
    const updateSecurityToggles = vi.fn(async () => "updated" as const);
    const result = await updatePollSecurityToggles(
      {
        loadOwnedPoll: async () => snapshot(),
        updateSecurityToggles,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      next,
    );
    expect(result).toEqual({
      ok: true,
      value: { kind: "updated", toggles: next },
    });
    expect(updateSecurityToggles).toHaveBeenCalledWith({
      pollId: POLL_ID,
      ownerUserId: OWNER,
      toggles: next,
      version: {
        kind: "increment_representation_version",
        pollId: POLL_ID,
        updatedAtMs: NOW,
      },
    });
  });

  it("returns poll_security_locked with the exact Voice line", async () => {
    const updateSecurityToggles = vi.fn();
    const result = await updatePollSecurityToggles(
      {
        loadOwnedPoll: async () => snapshot({ voterCount: 1 }),
        updateSecurityToggles,
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      { ...DEFAULT_TOGGLES, sessionChecks: false },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "poll_security_locked",
        message: SECURITY_COPY.locked,
      },
    });
    expect(result.ok === false && result.error.message).toBe(
      "Votes are in. Protections can tighten from here, not loosen.",
    );
    expect(updateSecurityToggles).not.toHaveBeenCalled();
  });

  it("maps adapter locked after a race without trusting the draft", async () => {
    const result = await updatePollSecurityToggles(
      {
        loadOwnedPoll: async () => snapshot({ voterCount: 0 }),
        updateSecurityToggles: async () => "locked",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      { ...DEFAULT_TOGGLES, sessionChecks: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("poll_security_locked");
    }
  });

  it("maps missing ownership to poll_not_found", async () => {
    const result = await updatePollSecurityToggles(
      {
        loadOwnedPoll: async () => null,
        updateSecurityToggles: async () => "updated",
        nowMs: () => NOW,
      },
      POLL_ID,
      OWNER,
      { ...DEFAULT_TOGGLES, captcha: true },
    );
    expect(result).toEqual({
      ok: false,
      error: { code: "poll_not_found", message: SECURITY_COPY.notFound },
    });
  });
});
