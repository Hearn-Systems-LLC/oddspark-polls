import { describe, expect, it, vi } from "vitest";
import {
  DEMO_POLL_COPY,
  DEMO_POLL_TEMPLATE,
  isDesignatedDemoPoll,
  isDemoPollCompatible,
  resetDemoPoll,
  resolveDemoPoll,
  validateDemoPollReference,
  type DemoPollSnapshot,
} from "../../src/modules/polls/demo-poll";
import type { PollId, PollOptionId, UserId } from "../../src/shared/domain/index";

const POLL_ID = "poll-demo" as PollId;
const SUCCESSOR_ID = "poll-demo-next" as PollId;
const OWNER_ID = "owner-demo" as UserId;

function demoSnapshot(
  overrides: Partial<DemoPollSnapshot> = {},
): DemoPollSnapshot {
  return {
    pollId: POLL_ID,
    ownerUserId: OWNER_ID,
    canonicalReference: "demo",
    pollType: "multiple_choice",
    question: "Best day for a long weekend?",
    description: "Creator-owned notes remain ordinary.",
    discoveryState: "listed",
    resultVisibility: "live",
    multiSelectEnabled: false,
    minSelections: null,
    maxSelections: null,
    sessionChecksEnabled: true,
    ipChecksEnabled: false,
    voterCodesEnabled: false,
    captchaEnabled: true,
    vpnBlockingEnabled: false,
    options: [
      { id: "option-friday" as PollOptionId, label: "Friday", position: 0 },
      { id: "option-monday" as PollOptionId, label: "Monday", position: 1 },
      {
        id: "option-either" as PollOptionId,
        label: "Either works",
        position: 2,
      },
    ],
    deadlineMs: null,
    closedAtMs: null,
    representationVersion: 7,
    voterCount: 3,
    moderationActionCount: 0,
    ...overrides,
  };
}

describe("Demo Poll designation", () => {
  it("pins the exact fixed voting template", () => {
    expect(DEMO_POLL_TEMPLATE).toEqual({
      question: "Best day for a long weekend?",
      optionLabels: ["Friday", "Monday", "Either works"],
      pollType: "multiple_choice",
      multiSelectEnabled: false,
      minSelections: 1,
      maxSelections: 1,
      resultVisibility: "live",
      deadlineMs: null,
      sessionChecksEnabled: true,
      ipChecksEnabled: false,
      voterCodesEnabled: false,
      captchaEnabled: true,
      vpnBlockingEnabled: false,
      commentsEnabled: false,
      initialDiscoveryState: "unlisted",
    });
  });

  it("accepts one exact lowercase non-reserved Custom Link", () => {
    expect(validateDemoPollReference("demo")).toEqual({
      ok: true,
      value: "demo",
    });
    for (const value of [
      undefined,
      "",
      " demo",
      "Demo",
      "demo_poll",
      "a".repeat(64),
      "api",
    ]) {
      const result = validateDemoPollReference(value);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toEqual({
          code: "demo_unavailable",
          message: DEMO_POLL_COPY.unavailableBody,
        });
      }
    }
  });

  it("designates only the exact configured reference", () => {
    expect(isDesignatedDemoPoll("demo", "demo")).toBe(true);
    expect(isDesignatedDemoPoll("demo-2", "demo")).toBe(false);
    expect(isDesignatedDemoPoll("demo", "Demo")).toBe(false);
  });
});

describe("Demo Poll compatibility", () => {
  it("allows ordinary description, listing, closed, and representation changes", () => {
    expect(isDemoPollCompatible(demoSnapshot())).toBe(true);
    expect(
      isDemoPollCompatible(
        demoSnapshot({
          description: null,
          discoveryState: "unlisted",
          closedAtMs: 1,
          representationVersion: 99,
        }),
      ),
    ).toBe(true);
  });

  it("rejects definition, visibility, deadline, and security drift", () => {
    const drifted: Partial<DemoPollSnapshot>[] = [
      { question: "A different question" },
      { pollType: "ranked_choice" },
      { resultVisibility: "after_close" },
      { deadlineMs: 1 },
      { multiSelectEnabled: true },
      { minSelections: 2 },
      { maxSelections: 2 },
      { sessionChecksEnabled: false },
      { ipChecksEnabled: true },
      { voterCodesEnabled: true },
      { captchaEnabled: false },
      { vpnBlockingEnabled: true },
      {
        options: [
          { id: "a" as PollOptionId, label: "Monday", position: 0 },
          { id: "b" as PollOptionId, label: "Friday", position: 1 },
          { id: "c" as PollOptionId, label: "Either works", position: 2 },
        ],
      },
    ];

    for (const drift of drifted) {
      expect(isDemoPollCompatible(demoSnapshot(drift))).toBe(false);
    }
  });

  it("returns one operational result for missing, unresolved, or drifted truth", () => {
    for (const snapshot of [
      null,
      demoSnapshot({ canonicalReference: "another" }),
      demoSnapshot({ captchaEnabled: false }),
    ]) {
      const result = resolveDemoPoll("demo", snapshot);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("demo_unavailable");
        expect(result.error.message).toBe(DEMO_POLL_COPY.unavailableBody);
      }
    }
  });
});

describe("resetDemoPoll", () => {
  it("replaces one eligible non-empty aggregate", async () => {
    const replace = vi.fn(async () => ({
      kind: "replaced" as const,
      pollId: SUCCESSOR_ID,
      representationVersion: 8,
    }));
    const result = await resetDemoPoll(
      {
        loadByReference: async () => demoSnapshot(),
        replace,
      },
      { configuredReference: "demo", requestedPollId: POLL_ID, ownerUserId: OWNER_ID },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        kind: "replaced",
        pollId: SUCCESSOR_ID,
        representationVersion: 8,
      },
    });
    expect(replace).toHaveBeenCalledWith({
      reference: "demo",
      expectedPollId: POLL_ID,
      ownerUserId: OWNER_ID,
    });
  });

  it("does not write for an already-empty current Poll", async () => {
    const replace = vi.fn();
    const result = await resetDemoPoll(
      {
        loadByReference: async () => demoSnapshot({ voterCount: 0 }),
        replace,
      },
      { configuredReference: "demo", requestedPollId: POLL_ID, ownerUserId: OWNER_ID },
    );
    expect(result).toEqual({
      ok: true,
      value: { kind: "unchanged", pollId: POLL_ID, representationVersion: 7 },
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("identifies an authenticated stale old detail without claiming success", async () => {
    const replace = vi.fn();
    const result = await resetDemoPoll(
      { loadByReference: async () => demoSnapshot({ pollId: SUCCESSOR_ID }), replace },
      { configuredReference: "demo", requestedPollId: POLL_ID, ownerUserId: OWNER_ID },
    );
    expect(result).toEqual({
      ok: true,
      value: { kind: "stale", currentPollId: SUCCESSOR_ID },
    });
    expect(replace).not.toHaveBeenCalled();
  });

  it("refuses non-owner, closed, Delisted, moderated, and drifted targets", async () => {
    const cases: Array<[Partial<DemoPollSnapshot>, string]> = [
      [{ ownerUserId: "someone-else" as UserId }, "demo_reset_not_found"],
      [{ closedAtMs: 1 }, "demo_reset_closed"],
      [{ discoveryState: "delisted" }, "demo_reset_delisted"],
      [{ moderationActionCount: 1 }, "demo_reset_moderated"],
      [{ captchaEnabled: false }, "demo_reset_ineligible"],
    ];

    for (const [overrides, code] of cases) {
      const replace = vi.fn();
      const result = await resetDemoPoll(
        { loadByReference: async () => demoSnapshot(overrides), replace },
        { configuredReference: "demo", requestedPollId: POLL_ID, ownerUserId: OWNER_ID },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(code);
      expect(replace).not.toHaveBeenCalled();
    }
  });

  it("maps persistence stale and integrity outcomes to stable errors", async () => {
    for (const outcome of ["stale", "integrity_failure"] as const) {
      const result = await resetDemoPoll(
        {
          loadByReference: async () => demoSnapshot(),
          replace: async () => ({ kind: outcome }),
        },
        { configuredReference: "demo", requestedPollId: POLL_ID, ownerUserId: OWNER_ID },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(
          outcome === "stale" ? "demo_reset_stale" : "demo_reset_integrity",
        );
      }
    }
  });
});
