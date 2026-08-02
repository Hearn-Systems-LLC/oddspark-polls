import { describe, expect, it, vi } from "vitest";
import {
  composeResultsValidator,
  queryLiveResults,
  queryResults,
  type LiveResultsPorts,
  type ResultsAccessEnvelope,
  type ResultsPorts,
  type ResultsTallyProjection,
  type ViewerContext,
} from "../../src/modules/results/index";
import type {
  PollId,
  PollOptionId,
  ResultVisibility,
  UserId,
} from "../../src/shared/domain/index";

const NOW = 1_800_000_000_000;
const POLL_ID = "results-poll" as PollId;
const OWNER_ID = "results-owner" as UserId;
const OTHER_ID = "results-other" as UserId;
const OPTION_A = "results-option-a" as PollOptionId;
const OPTION_B = "results-option-b" as PollOptionId;
const OPTION_C = "results-option-c" as PollOptionId;

const ANONYMOUS: ViewerContext = { userId: null };
const OWNER: ViewerContext = { userId: OWNER_ID };
const NON_OWNER: ViewerContext = { userId: OTHER_ID };

function envelope(
  overrides: Partial<ResultsAccessEnvelope> = {},
): ResultsAccessEnvelope {
  return {
    pollId: POLL_ID,
    question: "Where to lunch?",
    resultVisibility: "live",
    ownerUserId: OWNER_ID,
    deadlineMs: null,
    closedAtMs: null,
    multiSelectEnabled: false,
    canonicalReference: "team-lunch",
    ...overrides,
  };
}

function tally(
  overrides: Partial<ResultsTallyProjection> = {},
): ResultsTallyProjection {
  return {
    options: [
      { id: OPTION_A, label: "Pizza", position: 0, count: 0 },
      { id: OPTION_B, label: "Sushi", position: 1, count: 0 },
    ],
    voterCount: 0,
    selectionCount: 0,
    ...overrides,
  };
}

function ports(
  access: ResultsAccessEnvelope | null,
  projection: ResultsTallyProjection = tally(),
): ResultsPorts & { projectTally: ReturnType<typeof vi.fn> } {
  return {
    findAccessEnvelope: vi.fn(async () => access),
    projectTally: vi.fn(async () => projection),
  };
}

function livePorts(
  access: ResultsAccessEnvelope | null,
  representationVersion: number | null = 1,
  projection: ResultsTallyProjection = tally(),
): LiveResultsPorts & {
  readRepresentationVersion: ReturnType<typeof vi.fn>;
  projectVersionedTally: ReturnType<typeof vi.fn>;
} {
  return {
    findAccessEnvelope: vi.fn(async () => access),
    readRepresentationVersion: vi.fn(async () => representationVersion),
    projectVersionedTally: vi.fn(async () =>
      representationVersion === null
        ? null
        : { ...projection, representationVersion },
    ),
  };
}

describe("queryResults visibility matrix", () => {
  it.each([
    { name: "anonymous", viewer: ANONYMOUS },
    { name: "signed-in non-owner", viewer: NON_OWNER },
    { name: "owning Creator", viewer: OWNER },
  ])("shows a Live Poll's Tally to a $name viewer, open or closed", async ({
    viewer,
  }) => {
    for (const lifecycle of [
      {},
      { closedAtMs: NOW - 1 },
      { deadlineMs: NOW },
    ] as const) {
      const livePorts = ports(envelope(lifecycle));
      const view = await queryResults(livePorts, "team-lunch", viewer, NOW);
      expect(view.kind).toBe("visible");
      expect(livePorts.projectTally).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    { name: "anonymous", viewer: ANONYMOUS },
    { name: "signed-in non-owner", viewer: NON_OWNER },
    { name: "owning Creator", viewer: OWNER },
  ])("hides an open After Close Poll from a $name viewer without touching the tally", async ({
    viewer,
  }) => {
    const hiddenPorts = ports(
      envelope({ resultVisibility: "after_close", deadlineMs: NOW + 60_000 }),
    );
    const view = await queryResults(hiddenPorts, "team-lunch", viewer, NOW);
    expect(view).toEqual({
      kind: "after_close_hidden",
      pollId: POLL_ID,
      question: "Where to lunch?",
      canonicalReference: "team-lunch",
      deadlineMs: NOW + 60_000,
    });
    expect(hiddenPorts.projectTally).not.toHaveBeenCalled();
  });

  it("renders the no-timestamp hidden variant for a manual-close-only After Close Poll", async () => {
    const hiddenPorts = ports(
      envelope({ resultVisibility: "after_close", deadlineMs: null }),
    );
    const view = await queryResults(hiddenPorts, "team-lunch", ANONYMOUS, NOW);
    expect(view).toMatchObject({
      kind: "after_close_hidden",
      deadlineMs: null,
    });
    expect(hiddenPorts.projectTally).not.toHaveBeenCalled();
  });

  it("opens After Close the moment the deadline compares closed, with no write", async () => {
    const closedPorts = ports(
      envelope({ resultVisibility: "after_close", deadlineMs: NOW }),
    );
    // now === deadlineMs is closed (shared effective-state rule).
    const atDeadline = await queryResults(
      closedPorts,
      "team-lunch",
      ANONYMOUS,
      NOW,
    );
    expect(atDeadline.kind).toBe("visible");
    expect(atDeadline).toMatchObject({ status: "closed" });

    const openPorts = ports(
      envelope({ resultVisibility: "after_close", deadlineMs: NOW + 1 }),
    );
    const beforeDeadline = await queryResults(
      openPorts,
      "team-lunch",
      ANONYMOUS,
      NOW,
    );
    expect(beforeDeadline.kind).toBe("after_close_hidden");
    expect(openPorts.projectTally).not.toHaveBeenCalled();
  });

  it("exposes effective open status only on an entitled full Results view", async () => {
    const visiblePorts = ports(envelope({ deadlineMs: NOW + 1 }));
    await expect(
      queryResults(visiblePorts, "team-lunch", ANONYMOUS, NOW),
    ).resolves.toMatchObject({ kind: "visible", status: "open" });
  });

  it("opens After Close once closed_at is set", async () => {
    const closedPorts = ports(
      envelope({
        resultVisibility: "after_close",
        closedAtMs: NOW - 1,
        deadlineMs: NOW + 60_000,
      }),
    );
    const view = await queryResults(closedPorts, "team-lunch", ANONYMOUS, NOW);
    expect(view.kind).toBe("visible");
  });

  it("shows a Creator-Only Tally only to the owning Creator", async () => {
    const ownerPorts = ports(envelope({ resultVisibility: "creator_only" }));
    const ownerView = await queryResults(
      ownerPorts,
      "team-lunch",
      OWNER,
      NOW,
    );
    expect(ownerView.kind).toBe("visible");
    expect(ownerPorts.projectTally).toHaveBeenCalledTimes(1);
    expect(ownerPorts.projectTally).toHaveBeenCalledWith(POLL_ID);
  });

  it.each([
    { name: "anonymous", viewer: ANONYMOUS },
    { name: "signed-in non-owner", viewer: NON_OWNER },
  ])("hides a Creator-Only Tally from a $name viewer without touching the tally", async ({
    viewer,
  }) => {
    const hiddenPorts = ports(envelope({ resultVisibility: "creator_only" }));
    const view = await queryResults(hiddenPorts, "team-lunch", viewer, NOW);
    expect(view).toEqual({
      kind: "creator_only_hidden",
      pollId: POLL_ID,
      question: "Where to lunch?",
      canonicalReference: "team-lunch",
    });
    expect(hiddenPorts.projectTally).not.toHaveBeenCalled();
  });

  it("answers not_found for an absent Poll and never touches the tally", async () => {
    const missingPorts = ports(null);
    const view = await queryResults(missingPorts, "nope", ANONYMOUS, NOW);
    expect(view).toEqual({ kind: "not_found" });
    expect(missingPorts.projectTally).not.toHaveBeenCalled();
  });
});

describe("queryResults tally view", () => {
  it("computes percentages as the rounded share of Voters who selected each option", async () => {
    const visiblePorts = ports(
      envelope(),
      tally({
        options: [
          { id: OPTION_A, label: "Pizza", position: 0, count: 57 },
          { id: OPTION_B, label: "Sushi", position: 1, count: 65 },
        ],
        voterCount: 122,
        selectionCount: 122,
      }),
    );
    const view = await queryResults(visiblePorts, "team-lunch", ANONYMOUS, NOW);
    expect(view.kind).toBe("visible");
    if (view.kind !== "visible") {
      return;
    }
    // 57/122 = 46.7…% rounds to 47; the denominator is Voters, not selections.
    expect(view.tally.options.map(({ percent }) => percent)).toEqual([47, 53]);
    expect(view.tally.voterCount).toBe(122);
    expect(view.tally.selectionCount).toBe(122);
  });

  it("yields exactly 0 for every option when no one has voted", async () => {
    const visiblePorts = ports(envelope(), tally());
    const view = await queryResults(visiblePorts, "team-lunch", ANONYMOUS, NOW);
    if (view.kind !== "visible") {
      throw new Error("expected a visible tally");
    }
    expect(view.tally.options.map(({ percent }) => percent)).toEqual([0, 0]);
    expect(view.tally.empty).toBe(true);
    expect(view.tally.tied).toBe(false);
    expect(view.tally.options.every(({ leading }) => !leading)).toBe(true);
  });

  it("carries multi-select Voter and selection totals even when percentages pass 100", async () => {
    const visiblePorts = ports(
      envelope({ multiSelectEnabled: true }),
      tally({
        options: [
          { id: OPTION_A, label: "Pizza", position: 0, count: 3 },
          { id: OPTION_B, label: "Sushi", position: 1, count: 3 },
          { id: OPTION_C, label: "Tacos", position: 2, count: 2 },
        ],
        voterCount: 4,
        selectionCount: 8,
      }),
    );
    const view = await queryResults(visiblePorts, "team-lunch", ANONYMOUS, NOW);
    if (view.kind !== "visible") {
      throw new Error("expected a visible tally");
    }
    expect(view.tally.multiSelectEnabled).toBe(true);
    expect(view.tally.voterCount).toBe(4);
    expect(view.tally.selectionCount).toBe(8);
    expect(view.tally.options.map(({ percent }) => percent)).toEqual([
      75, 75, 50,
    ]);
  });

  it("renders the multi-select summary even when every Voter picked exactly one option", async () => {
    const visiblePorts = ports(
      envelope({ multiSelectEnabled: true }),
      tally({
        options: [
          { id: OPTION_A, label: "Pizza", position: 0, count: 1 },
          { id: OPTION_B, label: "Sushi", position: 1, count: 1 },
        ],
        voterCount: 2,
        selectionCount: 2,
      }),
    );
    const view = await queryResults(visiblePorts, "team-lunch", ANONYMOUS, NOW);
    if (view.kind !== "visible") {
      throw new Error("expected a visible tally");
    }
    expect(view.tally.multiSelectEnabled).toBe(true);
    expect(view.tally.selectionCount).toBe(view.tally.voterCount);
  });

  it("marks one unique positive maximum as the sole leader", async () => {
    const visiblePorts = ports(
      envelope(),
      tally({
        options: [
          { id: OPTION_A, label: "Pizza", position: 0, count: 5 },
          { id: OPTION_B, label: "Sushi", position: 1, count: 9 },
          { id: OPTION_C, label: "Tacos", position: 2, count: 2 },
        ],
        voterCount: 16,
        selectionCount: 16,
      }),
    );
    const view = await queryResults(visiblePorts, "team-lunch", ANONYMOUS, NOW);
    if (view.kind !== "visible") {
      throw new Error("expected a visible tally");
    }
    expect(view.tally.tied).toBe(false);
    expect(view.tally.empty).toBe(false);
    expect(view.tally.options.map(({ leading }) => leading)).toEqual([
      false,
      true,
      false,
    ]);
  });

  it("withdraws leadership on an exact positive tie without moving any rows", async () => {
    const visiblePorts = ports(
      envelope(),
      tally({
        options: [
          { id: OPTION_A, label: "Pizza", position: 0, count: 7 },
          { id: OPTION_B, label: "Sushi", position: 1, count: 7 },
          { id: OPTION_C, label: "Tacos", position: 2, count: 1 },
        ],
        voterCount: 15,
        selectionCount: 15,
      }),
    );
    const view = await queryResults(visiblePorts, "team-lunch", ANONYMOUS, NOW);
    if (view.kind !== "visible") {
      throw new Error("expected a visible tally");
    }
    expect(view.tally.tied).toBe(true);
    expect(view.tally.options.every(({ leading }) => !leading)).toBe(true);
    // Creator-authored order is preserved — ties never re-sort by count.
    expect(view.tally.options.map(({ id }) => id)).toEqual([
      OPTION_A,
      OPTION_B,
      OPTION_C,
    ]);
  });

  it("treats an all-zero tally as the empty state, never a tie", async () => {
    const visiblePorts = ports(envelope(), tally());
    const view = await queryResults(visiblePorts, "team-lunch", ANONYMOUS, NOW);
    if (view.kind !== "visible") {
      throw new Error("expected a visible tally");
    }
    expect(view.tally.empty).toBe(true);
    expect(view.tally.tied).toBe(false);
  });

  it("never marks a sole zero-count option as leading", async () => {
    const visiblePorts = ports(
      envelope(),
      tally({
        options: [
          { id: OPTION_A, label: "Pizza", position: 0, count: 0 },
        ],
      }),
    );
    const view = await queryResults(visiblePorts, "team-lunch", ANONYMOUS, NOW);
    if (view.kind !== "visible") {
      throw new Error("expected a visible tally");
    }
    expect(view.tally.empty).toBe(true);
    expect(view.tally.tied).toBe(false);
    expect(view.tally.options[0]?.leading).toBe(false);
  });
});

describe("live Results validator", () => {
  it("changes when the effective status changes at the same version", () => {
    expect(composeResultsValidator(7, "open")).not.toBe(
      composeResultsValidator(7, "closed"),
    );
  });

  it("changes when the version changes at the same effective status", () => {
    expect(composeResultsValidator(7, "open")).not.toBe(
      composeResultsValidator(8, "open"),
    );
  });

  it("is equal only when both version and effective status are equal", () => {
    expect(composeResultsValidator(7, "closed")).toBe(
      composeResultsValidator(7, "closed"),
    );
    expect(composeResultsValidator(7, "closed")).not.toBe(
      composeResultsValidator(8, "open"),
    );
    expect(composeResultsValidator(7, "open")).toBe('"7:open"');
  });

  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5])(
    "rejects malformed representation version %s",
    (version) => {
      expect(() => composeResultsValidator(version, "open")).toThrow(
        "Invalid representation version",
      );
    },
  );
});

describe("queryLiveResults authorization and projection", () => {
  it.each([
    {
      name: "open After Close for an anonymous viewer",
      access: envelope({
        resultVisibility: "after_close",
        deadlineMs: NOW + 1,
      }),
      viewer: ANONYMOUS,
      expected: "after_close_hidden",
    },
    {
      name: "open After Close for a signed-in viewer",
      access: envelope({
        resultVisibility: "after_close",
        deadlineMs: NOW + 1,
      }),
      viewer: NON_OWNER,
      expected: "after_close_hidden",
    },
    {
      name: "open After Close for the owning Creator",
      access: envelope({
        resultVisibility: "after_close",
        deadlineMs: NOW + 1,
      }),
      viewer: OWNER,
      expected: "after_close_hidden",
    },
    {
      name: "Creator-Only for an anonymous viewer",
      access: envelope({ resultVisibility: "creator_only" }),
      viewer: ANONYMOUS,
      expected: "creator_only_hidden",
    },
    {
      name: "Creator-Only for a non-owner",
      access: envelope({ resultVisibility: "creator_only" }),
      viewer: NON_OWNER,
      expected: "creator_only_hidden",
    },
  ])("never resolves a version or tally for $name", async ({
    access,
    viewer,
    expected,
  }) => {
    const hiddenPorts = livePorts(access, 17);
    const view = await queryLiveResults(
      hiddenPorts,
      "team-lunch",
      viewer,
      NOW,
      null,
    );
    expect(view).toEqual({
      kind: expected,
      pollId: POLL_ID,
      canonicalReference: "team-lunch",
    });
    expect(hiddenPorts.readRepresentationVersion).not.toHaveBeenCalled();
    expect(hiddenPorts.projectVersionedTally).not.toHaveBeenCalled();
    expect(view).not.toHaveProperty("representationVersion");
    expect(view).not.toHaveProperty("validator");
    expect(view).not.toHaveProperty("tally");
  });

  it.each([
    { name: "anonymous", viewer: ANONYMOUS },
    { name: "signed-in non-owner", viewer: NON_OWNER },
    { name: "owning Creator", viewer: OWNER },
  ])("shows closed After Close Results to a $name viewer", async ({ viewer }) => {
    const visiblePorts = livePorts(
      envelope({ resultVisibility: "after_close", deadlineMs: NOW }),
      17,
    );
    const view = await queryLiveResults(
      visiblePorts,
      "team-lunch",
      viewer,
      NOW,
      null,
    );
    expect(view).toMatchObject({
      kind: "visible",
      status: "closed",
      validator: '"17:closed"',
    });
  });

  it("shows Creator-Only Results to the owning Creator", async () => {
    const visiblePorts = livePorts(
      envelope({ resultVisibility: "creator_only" }),
      17,
    );
    await expect(
      queryLiveResults(
        visiblePorts,
        "team-lunch",
        OWNER,
        NOW,
        null,
      ),
    ).resolves.toMatchObject({ kind: "visible", status: "open" });
  });

  it("never resolves a version or tally for a missing Poll", async () => {
    const missingPorts = livePorts(null, 17);
    const view = await queryLiveResults(
      missingPorts,
      "not-there",
      ANONYMOUS,
      NOW,
      null,
    );
    expect(view).toEqual({ kind: "not_found" });
    expect(missingPorts.readRepresentationVersion).not.toHaveBeenCalled();
    expect(missingPorts.projectVersionedTally).not.toHaveBeenCalled();
  });

  it("returns the versioned Tally and open status from one full projection", async () => {
    const visiblePorts = livePorts(
      envelope(),
      17,
      tally({
        options: [
          { id: OPTION_A, label: "Pizza", position: 0, count: 2 },
          { id: OPTION_B, label: "Sushi", position: 1, count: 1 },
        ],
        voterCount: 3,
        selectionCount: 3,
      }),
    );
    const view = await queryLiveResults(
      visiblePorts,
      "team-lunch",
      ANONYMOUS,
      NOW,
      null,
    );
    expect(view).toMatchObject({
      kind: "visible",
      pollId: POLL_ID,
      canonicalReference: "team-lunch",
      representationVersion: 17,
      status: "open",
      validator: '"17:open"',
      tally: {
        voterCount: 3,
        selectionCount: 3,
        empty: false,
      },
    });
    expect(visiblePorts.readRepresentationVersion).not.toHaveBeenCalled();
    expect(visiblePorts.projectVersionedTally).toHaveBeenCalledWith(POLL_ID);
  });

  it("uses the cheap version read and skips the Tally when the validator matches", async () => {
    const visiblePorts = livePorts(envelope(), 17);
    const view = await queryLiveResults(
      visiblePorts,
      "team-lunch",
      ANONYMOUS,
      NOW,
      '"17:open"',
    );
    expect(view).toEqual({
      kind: "not_modified",
      pollId: POLL_ID,
      canonicalReference: "team-lunch",
      status: "open",
      validator: '"17:open"',
    });
    expect(visiblePorts.projectVersionedTally).not.toHaveBeenCalled();
  });

  it("treats now equal to the deadline as closed in the validator", async () => {
    const visiblePorts = livePorts(envelope({ deadlineMs: NOW }), 17);
    const view = await queryLiveResults(
      visiblePorts,
      "team-lunch",
      ANONYMOUS,
      NOW,
      null,
    );
    expect(view).toMatchObject({
      kind: "visible",
      status: "closed",
      validator: '"17:closed"',
    });
  });

  it("mints a full response from the projection snapshot when a Vote lands after the cheap read", async () => {
    const racingPorts = livePorts(envelope(), 17);
    racingPorts.projectVersionedTally.mockResolvedValueOnce({
      ...tally({
        options: [
          { id: OPTION_A, label: "Pizza", position: 0, count: 1 },
          { id: OPTION_B, label: "Sushi", position: 1, count: 0 },
        ],
        voterCount: 1,
        selectionCount: 1,
      }),
      representationVersion: 18,
    });
    await expect(
      queryLiveResults(
        racingPorts,
        "team-lunch",
        ANONYMOUS,
        NOW,
        '"16:open"',
      ),
    ).resolves.toMatchObject({
      kind: "visible",
      representationVersion: 18,
      validator: '"18:open"',
      tally: { voterCount: 1 },
    });
  });

  it.each([NaN, Infinity, -Infinity, 0, -1, 1.5])(
    "fails closed when the version read is malformed: %s",
    async (version) => {
      const malformedPorts = livePorts(envelope(), version);
      await expect(
        queryLiveResults(
          malformedPorts,
          "team-lunch",
          ANONYMOUS,
          NOW,
          '"999:open"',
        ),
      ).rejects.toThrow("Invalid representation version");
      expect(malformedPorts.projectVersionedTally).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the full projection disappears after authorization", async () => {
    const inconsistentPorts = livePorts(envelope(), 17);
    inconsistentPorts.projectVersionedTally.mockResolvedValueOnce(null);
    await expect(
      queryLiveResults(
        inconsistentPorts,
        "team-lunch",
        ANONYMOUS,
        NOW,
        null,
      ),
    ).rejects.toThrow("Live Results projection unavailable");
  });

  it("fails closed when the full projection carries a malformed version", async () => {
    const malformedPorts = livePorts(envelope(), 17);
    malformedPorts.projectVersionedTally.mockResolvedValueOnce({
      ...tally(),
      representationVersion: Number.NaN,
    });
    await expect(
      queryLiveResults(
        malformedPorts,
        "team-lunch",
        ANONYMOUS,
        NOW,
        '"16:open"',
      ),
    ).rejects.toThrow("Invalid representation version");
  });
});
